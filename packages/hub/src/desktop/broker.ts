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
    /** 两个方向各自的背压缓冲队列 */
    toAttach: RelayQueue
    toObserve: RelayQueue
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
    onSocketClose(ws: ServerWebSocket<DesktopWsData>): void
}

/** RFB 中继帧上限：RFB 消息单元远小于此；超限即协议错误（防恶意大帧） */
export const MAX_RELAY_FRAME_BYTES = 4 * 1024 * 1024

/** 背压缓冲上限：单方向积压超过即视为慢消费者，拆会话（防无界内存） */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

/** 背压轮询间隔：下游缓冲排空检查（openclaw 同款节奏） */
const DRAIN_CHECK_INTERVAL_MS = 25

/**
 * 单方向的中继队列。Bun 1.4.x 的 ServerWebSocket 无 pause/resume（客户端 WebSocket
 * 才有），读取侧不可暂停，因此背压以应用层缓冲实现：send 返回 -1 即进入缓冲 +
 * 轮询 getBufferedAmount 排空，积压超限拆会话。
 */
interface RelayQueue {
    frames: unknown[]
    bytes: number
    paused: boolean
    drainTimer?: ReturnType<typeof setInterval>
}

function frameBytes(data: unknown): number {
    if (data instanceof Uint8Array) return data.byteLength
    if (data instanceof ArrayBuffer) return data.byteLength
    if (typeof data === 'string') return data.length
    return 64
}

export const DESKTOP_CLOSE_CODE_SUPERSEDED = 4000
export const DESKTOP_CLOSE_CODE_PEER_GONE = 4001
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
        session.tearingDown = true
        if (session.pendingAttachTimer) {
            clearTimeout(session.pendingAttachTimer)
            session.pendingAttachTimer = undefined
        }
        if (session.pendingObserveTimer) {
            clearTimeout(session.pendingObserveTimer)
            session.pendingObserveTimer = undefined
        }
        if (session.toAttach.drainTimer) {
            clearInterval(session.toAttach.drainTimer)
        }
        if (session.toObserve.drainTimer) {
            clearInterval(session.toObserve.drainTimer)
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

    /** 排空轮询：目标缓冲清零后把积压帧续发出去；目标关闭则交给 teardown 收尾 */
    function startDrainPoll(
        session: DesktopSession,
        to: ServerWebSocket<DesktopWsData>,
        queue: RelayQueue,
    ): void {
        if (queue.drainTimer) {
            return
        }
        const timer = setInterval(() => {
            if (session.tearingDown || to.readyState !== 1 /* OPEN */) {
                clearInterval(timer)
                queue.drainTimer = undefined
                return
            }
            if (typeof to.getBufferedAmount === 'function' && to.getBufferedAmount() > 0) {
                return
            }
            while (queue.frames.length > 0) {
                const frame = queue.frames.shift()
                if (to.send(frame as never) === -1) {
                    return // 仍背压，等下一轮
                }
            }
            queue.paused = false
            queue.bytes = 0
            clearInterval(timer)
            queue.drainTimer = undefined
        }, DRAIN_CHECK_INTERVAL_MS)
        timer.unref?.()
        queue.drainTimer = timer
    }

    function relay(
        session: DesktopSession,
        to: ServerWebSocket<DesktopWsData>,
        queue: RelayQueue,
        data: unknown,
    ): void {
        const bytes = frameBytes(data)
        if (queue.paused) {
            queue.frames.push(data)
            queue.bytes += bytes
            if (queue.bytes > MAX_BUFFERED_BYTES) {
                // 慢消费者：积压超限，放弃会话而非无界缓冲
                teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PROTOCOL, 'slow consumer')
            }
            return
        }
        if (to.send(data as never) === -1) {
            queue.paused = true
            queue.frames.push(data)
            queue.bytes += bytes
            startDrainPoll(session, to, queue)
        }
    }

    function tryStartRelay(session: DesktopSession): void {
        // 两侧就绪且 metadata 已过校验：建立 RFB 握手代理（代认证），结束后进入纯透传
        if (session.attach && session.observe && session.attachMetadataAccepted && !session.handshake) {
            const handshake = new RfbHandshakeProxy(session.vncPassword, {
                onToBrowser: (data) => {
                    if (session.observe) relay(session, session.observe, session.toObserve, data)
                },
                onToServer: (data) => {
                    if (session.attach) relay(session, session.attach, session.toAttach, data)
                },
                onDone: (ok, reason) => {
                    if (ok) {
                        session.handshakeLive = true
                        // 握手期间如有背压积压，排空后进入稳态
                        startDrainPoll(session, session.observe!, session.toObserve)
                        startDrainPoll(session, session.attach!, session.toAttach)
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
            session.toObserve.bytes = 0
            session.toAttach.bytes = 0
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
                toAttach: { frames: [], bytes: 0, paused: false },
                toObserve: { frames: [], bytes: 0, paused: false },
            }
            sessions.set(sessionId, session)
            sessionIdByMachine.set(machineId, sessionId)

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
                    session.handshake.feedServer(data as Uint8Array)
                } else {
                    session.handshake.feedBrowser(data as Uint8Array)
                }
                return
            }

            if (meta.role === 'attach') {
                if (!session.observe) {
                    session.toObserve.frames.push(data)
                    session.toObserve.bytes += frameBytes(data)
                    return
                }
                relay(session, session.observe, session.toObserve, data)
                return
            }

            if (!session.attach) {
                session.toAttach.frames.push(data)
                session.toAttach.bytes += frameBytes(data)
                return
            }
            relay(session, session.attach, session.toAttach, data)
        },

        onSocketClose(ws) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session || session.tearingDown) {
                return
            }
            // 迭代 1 语义：任一侧离开即会话终止（断线自动恢复由 web 侧重走 watch）
            teardownSession(session.sessionId, DESKTOP_CLOSE_CODE_PEER_GONE, 'peer gone')
        },
    }
}
