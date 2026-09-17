/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Desktop 流会话 broker（迭代 1：单会话直通 + 抢占）。
 *
 * 职责：同 machineId 一条观看链路（cli attach 侧 + 浏览器 observe 侧）的
 * 票据签发、两侧配对、双向字节透传、生命周期（抢占/断开拆会话）。
 * hub 不解读 RFB 语义——两侧之间是纯字节流，协议协商发生在
 * 浏览器 noVNC 与被控端 VNC server 之间（hub 代认证在迭代 2 引入）。
 */

import { randomUUID } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import { desktopAttachMetadataSchema, DESKTOP_WS_DATA_KEY } from '@mobi/shared'
import { createOneTimeTicketStore } from './tickets'
import { RfbHandshakeProxy } from './rfbPreauth'
import { hubLogger } from '../logger'

export interface DesktopSessionInfo {
    sessionId: string
    machineId: string
    startedAtMs: number
}

export interface WatchedSession extends DesktopSessionInfo {
    attachTicket: string
    observeToken: string
    expiresAtMs: number
}

type SideRole = 'attach' | 'observe'

interface DesktopWsData {
    [DESKTOP_WS_DATA_KEY]: { role: SideRole; sessionId: string }
}

interface DesktopSession extends DesktopSessionInfo {
    attachTicket: string
    observeToken: string
    attach?: ServerWebSocket<DesktopWsData>
    observe?: ServerWebSocket<DesktopWsData>
    /** attach 侧首帧 metadata 是否已通过校验 */
    attachMetadataAccepted: boolean
    /** VNC 密码（来自 attach metadata；仅内存持有，供握手代理使用） */
    vncPassword?: string
    /** RFB 握手代理（metadata 通过后创建；phase=live 起透传不再经过它） */
    handshake?: RfbHandshakeProxy
    handshakeLive: boolean
    /** attach 未到达时的过期定时器（防浏览器悬挂占位） */
    pendingAttachTimer?: ReturnType<typeof setTimeout>
    /** observe 未到达时的过期定时器（attach 开链后起，防 cli 泵空跑占用 upstream） */
    pendingObserveTimer?: ReturnType<typeof setTimeout>
    /** 拆除中标记：防 close 事件与 teardown 互相递归 */
    tearingDown: boolean
    /** observe/attach 未就绪时的早期字节缓冲（非背压队列，见 EarlyFrameBuffer） */
    toAttach: EarlyFrameBuffer
    toObserve: EarlyFrameBuffer
    /** 透传统计（每方向收发字节；周期性落日志供诊断） */
    stats: { attachIn: number; observeOut: number }
    statsTimer?: ReturnType<typeof setInterval>
}

export interface DesktopBroker {
    /** 为 machine 开一条新观看会话；已有会话被抢占（旧两侧以 4000 关闭） */
    watchSession(machineId: string, nowMs?: number): WatchedSession
    /** attach ticket 兑换 → sessionId（单次，无效/过期返回 null） */
    consumeAttachTicket(ticket: string, nowMs?: number): string | null
    /** observe token 兑换 → sessionId（单次，无效/过期返回 null） */
    consumeObserveToken(token: string, nowMs?: number): string | null
    /** 活跃会话列表（侧边栏列表 API 的数据源） */
    listSessions(): DesktopSessionInfo[]
    /** 显式拆除（抢占/关闭 API/协议错误统一入口） */
    teardownSession(sessionId: string, code: number, reason: string): void
    /** websocket open/message/close 的领域处理（transport.ts 调用） */
    onSocketOpen(ws: ServerWebSocket<DesktopWsData>): void
    onSocketMessage(ws: ServerWebSocket<DesktopWsData>, data: unknown): void
    /** closeCode/reason 为 attach 侧主动关闭的归因（如 4003 上游不可用），透传给观看侧 */
    onSocketClose(ws: ServerWebSocket<DesktopWsData>, closeCode?: number, closeReason?: string): void
}

/** RFB 中继帧上限：RFB 消息单元远小于此；超限即协议错误（防恶意大帧） */
export const MAX_RELAY_FRAME_BYTES = 4 * 1024 * 1024

/**
 * 慢消费者护栏：目标方向未送达积压（cli 上行字节 - 观看侧下行字节）超过阈值
 * 即拆会话，防 Bun 内部缓冲无界增长。须容得下真实桌面的单帧洪峰：retina 全屏
 * raw 一帧约 20MB（3008×1692×4），noVNC 的 request-response 节奏下初始 full
 * update 会瞬时打进缓冲。
 */
const MAX_BUFFERED_BYTES = 64 * 1024 * 1024

/**
 * 早期字节缓冲：observe 未加入（或握手代理未建立）前上游/浏览器先到的字节。
 * 注意这不是背压队列——Bun 的 ws.send 返回 -1 时数据已入其内部缓冲并自动
 * flush，无需应用层排队（曾误实现 bufferedAmount 排空轮询，因 Bun 的
 * bufferedAmount 只在 send 时增长、从不衰减而永久死锁）。
 */
interface EarlyFrameBuffer {
    frames: unknown[]
}

function frameBytes(data: unknown): number {
    if (data instanceof Uint8Array) return data.byteLength
    if (data instanceof ArrayBuffer) return data.byteLength
    if (typeof data === 'string') return data.length
    return 64
}

export const DESKTOP_CLOSE_CODE_SUPERSEDED = 4000
export const DESKTOP_CLOSE_CODE_PEER_GONE = 4001
/** 主动/管理关闭（用户从列表关流、cli 不可达回滚）：观看侧应归因展示而非自动重连 */
export const DESKTOP_CLOSE_CODE_CLOSED = 4002
export const DESKTOP_CLOSE_CODE_PROTOCOL = 1008

export function createDesktopBroker(options: { ttlMs?: number; now?: () => number } = {}): DesktopBroker {
    const ttlMs = options.ttlMs ?? 60_000
    const now = options.now ?? Date.now

    const attachTickets = createOneTimeTicketStore<string>()
    const observeTokens = createOneTimeTicketStore<string>()
    const sessions = new Map<string, DesktopSession>()
    const sessionIdByMachine = new Map<string, string>()

    function teardownSession(sessionId: string, code: number, reason: string): void {
        const session = sessions.get(sessionId)
        if (!session || session.tearingDown) {
            return
        }
        hubLogger.warn(`[desktop] teardown session=${sessionId} machine=${session.machineId} code=${code} reason=${reason}`)
        session.tearingDown = true
        if (session.statsTimer) {
            clearInterval(session.statsTimer)
            session.statsTimer = undefined
        }
        if (session.pendingAttachTimer) {
            clearTimeout(session.pendingAttachTimer)
            session.pendingAttachTimer = undefined
        }
        if (session.pendingObserveTimer) {
            clearTimeout(session.pendingObserveTimer)
            session.pendingObserveTimer = undefined
        }
        attachTickets.cancel(session.attachTicket)
        observeTokens.cancel(session.observeToken)
        sessions.delete(sessionId)
        if (sessionIdByMachine.get(session.machineId) === sessionId) {
            sessionIdByMachine.delete(session.machineId)
        }
        session.attach?.close(code, reason)
        session.observe?.close(code, reason)
    }

    /**
     * 中继一帧到目标 ws。
     *
     * Bun 的 ServerWebSocket.send 返回 -1 只表示「已入内部缓冲、未上 wire」，
     * 数据不丢且由 Bun 自行 flush——无需也无法用 getBufferedAmount 做排空轮询
     * （实测 bufferedAmount 只在 send 时增长、从不随后台 flush 衰减，等它清零
     * 是永久死锁，曾导致真实桌面流卡死）。慢消费者护栏改为字节差值：目标方向
     * 的未送达积压超过阈值即拆会话，防无界内存。
     */
    function relay(
        session: DesktopSession,
        to: ServerWebSocket<DesktopWsData>,
        data: unknown,
    ): void {
        if (to === session.observe) {
            session.stats.observeOut += frameBytes(data)
            if (session.stats.attachIn - session.stats.observeOut > MAX_BUFFERED_BYTES) {
                teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, 'slow consumer')
            }
        }
        to.send(data as never)
    }

    function tryStartRelay(session: DesktopSession): void {
        // 两侧就绪且 metadata 已过校验：建立 RFB 握手代理（代认证），结束后进入纯透传
        if (session.attach && session.observe && session.attachMetadataAccepted && !session.handshake) {
            const handshake = new RfbHandshakeProxy(session.vncPassword, {
                onTrace: (message) => hubLogger.info(`[desktop] handshake session=${session.sessionId} machine=${session.machineId} ${message}`),
                onToBrowser: (data) => {
                    if (session.observe) relay(session, session.observe, data)
                },
                onToServer: (data) => {
                    if (session.attach) relay(session, session.attach, data)
                },
                onDone: (ok, reason) => {
                    if (ok) {
                        session.handshakeLive = true
                        // 握手期间如有背压积压，排空后进入稳态
                    } else {
                        teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, reason ?? 'handshake failed')
                    }
                },
            })
            session.handshake = handshake
            // 握手建立前缓冲的早期字节（如 macOS 立即发出的版本串）先喂给代理
            for (const frame of session.toObserve.frames.splice(0)) {
                handshake.feedServer(frame as Uint8Array)
            }
            for (const frame of session.toAttach.frames.splice(0)) {
                handshake.feedBrowser(frame as Uint8Array)
            }
        }
    }

    function handleAttachFirstFrame(
        session: DesktopSession,
        data: unknown,
    ): void {
        // 首帧必须是二进制 JSON 且 machineId 与会话一致，否则协议错误拆会话（票据随之作废）
        let metadata: unknown
        try {
            if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
                throw new Error('metadata must be binary')
            }
            const bytes = data instanceof Uint8Array ? data : Buffer.from(data as ArrayBuffer)
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELAY_FRAME_BYTES) {
                throw new Error('metadata size out of range')
            }
            metadata = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
            teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, 'invalid attach metadata')
            return
        }

        const parsed = desktopAttachMetadataSchema.safeParse(metadata)
        if (!parsed.success || parsed.data.machineId !== session.machineId) {
            teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, 'attach metadata mismatch')
            return
        }

        // 读取侧不可暂停（Bun ServerWebSocket 无 pause）：metadata 之后、observe 加入
        // 之前到达的上游早期字节由 toObserve 队列缓冲，observe 加入后排空，无丢失
        session.attachMetadataAccepted = true
        session.vncPassword = parsed.data.vncPassword
        tryStartRelay(session)
    }

    return {
        watchSession(machineId, nowMs = now()) {
            // 抢占：同 machineId 旧会话拆除（旧两侧收到 superseded）
            const existingId = sessionIdByMachine.get(machineId)
            if (existingId) {
                teardownSession(existingId, DESKTOP_CLOSE_CODE_SUPERSEDED, 'superseded')
            }

            const sessionId = randomUUID()
            const attachGrant = attachTickets.mint(sessionId, { nowMs, ttlMs })
            const observeGrant = observeTokens.mint(sessionId, { nowMs, ttlMs })
            const session: DesktopSession = {
                sessionId,
                machineId,
                startedAtMs: nowMs,
                attachTicket: attachGrant.token,
                observeToken: observeGrant.token,
                attachMetadataAccepted: false,
                handshakeLive: false,
                tearingDown: false,
                // 背压缓冲仅在 send 返回 -1 时启用；上游早期字节（observe 未到）的
                // 缓冲由 onSocketMessage 显式入队，握手建立时移交给代理
                toAttach: { frames: [] },
                toObserve: { frames: [] },
                stats: { attachIn: 0, observeOut: 0 },
            }
            sessions.set(sessionId, session)
            sessionIdByMachine.set(machineId, sessionId)

            // 透传吞吐统计（2s 一次）：桌面流是黑盒字节管道，无统计无法诊断停滞
            session.statsTimer = setInterval(() => {
                if (session.tearingDown) {
                    return
                }
                const s = session.stats
                hubLogger.info(
                    `[desktop] stats session=${sessionId} attachIn=${s.attachIn} observeOut=${s.observeOut}`,
                )
            }, 2_000)
            session.statsTimer.unref?.()

            // attach 超时未到：会话过期（浏览器悬挂占位防泄漏）；attach 到达后清定时器
            session.pendingAttachTimer = setTimeout(() => {
                if (!session.attach) {
                    teardownSession(sessionId, DESKTOP_CLOSE_CODE_PEER_GONE, 'attach timeout')
                }
            }, ttlMs)
            session.pendingAttachTimer.unref?.()

            return {
                sessionId,
                machineId,
                startedAtMs: session.startedAtMs,
                attachTicket: attachGrant.token,
                observeToken: observeGrant.token,
                expiresAtMs: observeGrant.expiresAtMs,
            }
        },

        consumeAttachTicket(ticket, nowMs = now()) {
            return attachTickets.consume(ticket, nowMs)
        },

        consumeObserveToken(token, nowMs = now()) {
            return observeTokens.consume(token, nowMs)
        },

        listSessions() {
            return Array.from(sessions.values()).map(({ sessionId, machineId, startedAtMs }) => ({
                sessionId,
                machineId,
                startedAtMs,
            }))
        },

        teardownSession,

        onSocketOpen(ws) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session) {
                ws.close(DESKTOP_CLOSE_CODE_PROTOCOL, 'session gone')
                return
            }
            if (meta.role === 'attach') {
                if (session.pendingAttachTimer) {
                    clearTimeout(session.pendingAttachTimer)
                    session.pendingAttachTimer = undefined
                }
                session.attach = ws
                // observe 一直不来（token 过期/页面被杀）会话即悬挂：cli 泵空跑、
                // upstream VNC 连接被无谓占用——attach 开链后起同等时效的兜底定时器
                if (!session.pendingObserveTimer) {
                    const timer = setTimeout(() => {
                        if (!session.observe) {
                            teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PEER_GONE, 'observe timeout')
                        }
                    }, ttlMs)
                    timer.unref?.()
                    session.pendingObserveTimer = timer
                }
            } else {
                if (session.pendingObserveTimer) {
                    clearTimeout(session.pendingObserveTimer)
                    session.pendingObserveTimer = undefined
                }
                session.observe = ws
            }
            tryStartRelay(session)
        },

        onSocketMessage(ws, data) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session || session.tearingDown) {
                return
            }

            if (meta.role === 'attach' && !session.attachMetadataAccepted) {
                handleAttachFirstFrame(session, data)
                return
            }

            // 每帧大小守卫（防恶意大帧）
            if (frameBytes(data) > MAX_RELAY_FRAME_BYTES) {
                teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, 'frame too large')
                return
            }

            // 握手相位：字节交给 RFB 代理（代认证），完成（live）后不再经过它
            if (session.handshake && !session.handshakeLive) {
                if (meta.role === 'attach') {
                    session.stats.attachIn += frameBytes(data)
                    session.handshake.feedServer(data as Uint8Array)
                } else {
                    session.handshake.feedBrowser(data as Uint8Array)
                }
                return
            }

            if (meta.role === 'attach') {
                session.stats.attachIn += frameBytes(data)
                if (!session.observe) {
                    session.toObserve.frames.push(data)
                    return
                }
                relay(session, session.observe, data)
                return
            }

            if (!session.attach) {
                session.toAttach.frames.push(data)
                return
            }
            relay(session, session.attach, data)
        },

        onSocketClose(ws, closeCode, closeReason) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session || session.tearingDown) {
                return
            }
            // 迭代 1 语义：任一侧离开即会话终止。attach 侧若带 4xxx 归因码
            // （如 4003 上游不可用）则原样透传给观看侧，Provider 可归因不重连；
            // 普通断开（页面关闭/网络）归一为 4001 peer gone
            const code = closeCode && closeCode >= 4000 ? closeCode : DESKTOP_CLOSE_CODE_PEER_GONE
            teardownSession(session.sessionId, code, closeReason || 'peer gone')
        },
    }
}
