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
import { DESKTOP_CLOSE_ATTRIBUTIONS, DESKTOP_WS_DATA_KEY, type DesktopControlState } from '@mobi/shared'
import { createOneTimeTicketStore } from './tickets'
import { RelayPath, frameBytes, type RelayAction } from './relayPath'
import { hubLogger } from '../logger'

/** 对外形状：streams 列表与 watch 响应条目 */
export interface DesktopSessionInfo {
    sessionId: string
    machineId: string
    startedAtMs: number
    /** 控制权状态（迭代 2）：供 web 初次对齐，由 controlled 布尔派生 */
    control: DesktopControlState
}

export interface DesktopControlChange {
    sessionId: string
    machineId: string
    control: DesktopControlState
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

/**
 * 会话内部状态：控制权唯一事实源是 `controlled` 布尔，对外形状（含 control 枚举）
 * 由 controlInfo 统一派生——不在内部状态上冗余存枚举。字节相位（metadata 门/
 * 早期缓冲/握手代答/输入过滤）全部在 relayPath（RelayPath 相位机）里，本会话
 * 只持会话生命周期与 WS 胶水。
 */
interface DesktopSession {
    sessionId: string
    machineId: string
    startedAtMs: number
    attachTicket: string
    observeToken: string
    attach?: ServerWebSocket<DesktopWsData>
    observe?: ServerWebSocket<DesktopWsData>
    /** attach 未到达时的过期定时器（防浏览器悬挂占位） */
    pendingAttachTimer?: ReturnType<typeof setTimeout>
    /** observe 未到达时的过期定时器（attach 开链后起，防 cli 泵空跑占用 upstream） */
    pendingObserveTimer?: ReturnType<typeof setTimeout>
    /** 拆除中标记：防 close 事件与 teardown 互相递归 */
    tearingDown: boolean
    /** 中继相位机：feed/peerJoined 返回待执行动作，由本 broker 落到 WS 上 */
    relayPath: RelayPath
    /** 透传统计（每方向收发字节；周期性落日志供诊断） */
    stats: { attachIn: number; observeOut: number }
    statsTimer?: ReturnType<typeof setInterval>
    /** 控制权状态（迭代 2）：view-only 时 observe 上行输入被 inputFilter 剥除 */
    controlled: boolean
    /** 控制权不操作超时定时器（授予后起，放行输入即重置；回落/拆除时清） */
    controlIdleTimer?: ReturnType<typeof setTimeout>
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
    /** 显式拆除（抢占/关闭 API/协议错误统一入口）；返回是否真的拆了一个活跃会话 */
    teardownSession(sessionId: string, code: number, reason: string): boolean
    /** 授予控制权（幂等；按 machineId 定位——同 machine 同时只有一条观看流）；无会话返回 null */
    grantControl(machineId: string): DesktopControlChange | null
    /** 退出控制权（幂等，回落原因供日志/归因）；无会话返回 null */
    releaseControl(machineId: string, reason: string): DesktopControlChange | null
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
 * 协议错误关闭码（帧超限/元数据非法/解析失败等）：reason 随场景变化、不进归因
 * 注册表（非跨端归因概念成员）——观看端按「查不到条目 → 网络类」处理。
 */
const DESKTOP_CLOSE_PROTOCOL = 1008

/** 会话级定时器清理：teardown 与 open 各点共用，防新增定时器漏清 */
function clearTimer(timer?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): undefined {
    if (timer) {
        clearTimeout(timer)
        clearInterval(timer)
    }
    return undefined
}

export function createDesktopBroker(options: {
    ttlMs?: number
    /** 控制权不操作超时：超过即回落 view-only（spec 三重回落之一）；测试/E2E 可注入缩短 */
    controlIdleMs?: number
    /** 控制权状态变化回调（授予/退出/空闲超时回落）：装配层接 SSE 广播 */
    onControlChange?: (change: DesktopControlChange) => void
    now?: () => number
} = {}): DesktopBroker {
    const ttlMs = options.ttlMs ?? 60_000
    const controlIdleMs = options.controlIdleMs ?? 600_000
    const onControlChange = options.onControlChange
    const now = options.now ?? Date.now

    const attachTickets = createOneTimeTicketStore<string>()
    const observeTokens = createOneTimeTicketStore<string>()
    const sessions = new Map<string, DesktopSession>()
    const sessionIdByMachine = new Map<string, string>()

    function teardownSession(sessionId: string, code: number, reason: string): boolean {
        const session = sessions.get(sessionId)
        if (!session || session.tearingDown) {
            return false
        }
        hubLogger.warn(`[desktop] teardown session=${sessionId} machine=${session.machineId} code=${code} reason=${reason}`)
        session.tearingDown = true
        session.statsTimer = clearTimer(session.statsTimer)
        session.pendingAttachTimer = clearTimer(session.pendingAttachTimer)
        session.pendingObserveTimer = clearTimer(session.pendingObserveTimer)
        session.controlIdleTimer = clearTimer(session.controlIdleTimer)
        attachTickets.cancel(session.attachTicket)
        observeTokens.cancel(session.observeToken)
        sessions.delete(sessionId)
        if (sessionIdByMachine.get(session.machineId) === sessionId) {
            sessionIdByMachine.delete(session.machineId)
        }
        session.attach?.close(code, reason)
        session.observe?.close(code, reason)
        return true
    }

    function controlInfo(session: DesktopSession): DesktopControlChange {
        return { sessionId: session.sessionId, machineId: session.machineId, control: session.controlled ? 'controlled' : 'view-only' }
    }

    /** 控制权空闲计时：授予后起、放行输入即重置；到点回落（不拆流） */
    function armControlIdleTimer(session: DesktopSession): void {
        if (session.controlIdleTimer) {
            clearTimeout(session.controlIdleTimer)
        }
        const timer = setTimeout(() => {
            applyControlState(session, false, 'control idle timeout')
        }, controlIdleMs)
        timer.unref?.()
        session.controlIdleTimer = timer
    }

    function applyControlState(session: DesktopSession, controlled: boolean, reason: string): void {
        if (session.controlled === controlled) {
            return
        }
        session.controlled = controlled
        session.relayPath.setControlled(controlled)
        if (controlled) {
            armControlIdleTimer(session)
        } else {
            session.controlIdleTimer = clearTimer(session.controlIdleTimer)
        }
        hubLogger.info(`[desktop] control session=${session.sessionId} machine=${session.machineId} state=${controlled ? 'controlled' : 'view-only'} reason=${reason}`)
        onControlChange?.(controlInfo(session))
    }

    /** 控制权变迁的唯一路径：按 machineId 定位会话（幂等；无活跃会话返回 null） */
    function changeControl(machineId: string, controlled: boolean, reason: string): DesktopControlChange | null {
        const sessionId = sessionIdByMachine.get(machineId)
        const session = sessionId ? sessions.get(sessionId) : undefined
        if (!session || session.tearingDown) {
            return null
        }
        applyControlState(session, controlled, reason)
        return controlInfo(session)
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
                teardownSession(session.sessionId, DESKTOP_CLOSE_PROTOCOL, 'slow consumer')
            }
        }
        to.send(data as never)
    }

    /**
     * 执行相位机产出的动作：forward 落到目标方向的 WS，fail 按协议错误拆会话。
     * fail 恒为末位动作（握手失败前可能已有下行字节，如认证失败的 reason string——
     * 先送达浏览器再拆除，noVNC 才能在 securityfailure 里给出可理解文案）。
     */
    function runRelayActions(session: DesktopSession, actions: RelayAction[]): void {
        for (const action of actions) {
            if (action.kind === 'forward') {
                const to = action.target === 'attach' ? session.attach : session.observe
                if (to) {
                    relay(session, to, action.data)
                }
            } else {
                teardownSession(session.sessionId, DESKTOP_CLOSE_PROTOCOL, action.reason)
                return
            }
        }
    }

    return {
        watchSession(machineId, nowMs = now()) {
            // 抢占：同 machineId 旧会话拆除（旧两侧收到 superseded）
            const existingId = sessionIdByMachine.get(machineId)
            if (existingId) {
                teardownSession(existingId, DESKTOP_CLOSE_ATTRIBUTIONS.superseded.code, DESKTOP_CLOSE_ATTRIBUTIONS.superseded.prose)
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
                tearingDown: false,
                // 相位机先行装配：控制权输入观测经闭包回到本会话的空闲计时
                relayPath: new RelayPath({
                    machineId,
                    maxFrameBytes: MAX_RELAY_FRAME_BYTES,
                    onTrace: (message) => hubLogger.info(`[desktop] relay session=${sessionId} machine=${machineId} ${message}`),
                    onInputObserved: () => {
                        if (session.controlled) {
                            armControlIdleTimer(session)
                        }
                    },
                }),
                stats: { attachIn: 0, observeOut: 0 },
                controlled: false,
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
                    teardownSession(sessionId, DESKTOP_CLOSE_ATTRIBUTIONS.peerGone.code, 'attach timeout')
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
                control: controlInfo(session).control,
            }
        },

        consumeAttachTicket(ticket, nowMs = now()) {
            return attachTickets.consume(ticket, nowMs)
        },

        consumeObserveToken(token, nowMs = now()) {
            return observeTokens.consume(token, nowMs)
        },

        listSessions() {
            return Array.from(sessions.values()).map((session) => ({
                sessionId: session.sessionId,
                machineId: session.machineId,
                startedAtMs: session.startedAtMs,
                control: session.controlled ? ('controlled' as const) : ('view-only' as const),
            }))
        },

        grantControl(machineId) {
            return changeControl(machineId, true, 'granted by user')
        },

        releaseControl(machineId, reason) {
            return changeControl(machineId, false, reason)
        },

        teardownSession,

        onSocketOpen(ws) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session) {
                ws.close(DESKTOP_CLOSE_PROTOCOL, 'session gone')
                return
            }
            if (meta.role === 'attach') {
                session.pendingAttachTimer = clearTimer(session.pendingAttachTimer)
                session.attach = ws
                // observe 一直不来（token 过期/页面被杀）会话即悬挂：cli 泵空跑、
                // upstream VNC 连接被无谓占用——attach 开链后起同等时效的兜底定时器
                if (!session.pendingObserveTimer) {
                    const timer = setTimeout(() => {
                        if (!session.observe) {
                            teardownSession(session.sessionId, DESKTOP_CLOSE_ATTRIBUTIONS.peerGone.code, 'observe timeout')
                        }
                    }, ttlMs)
                    timer.unref?.()
                    session.pendingObserveTimer = timer
                }
            } else {
                session.pendingObserveTimer = clearTimer(session.pendingObserveTimer)
                session.observe = ws
            }
            runRelayActions(session, session.relayPath.peerJoined(meta.role))
        },

        onSocketMessage(ws, data) {
            const meta = ws.data[DESKTOP_WS_DATA_KEY]
            const session = sessions.get(meta.sessionId)
            if (!session || session.tearingDown) {
                return
            }
            // attach 侧入口字节统计（含 metadata 门/守卫拦截的帧——诊断口径：socket 收到多少）
            if (meta.role === 'attach') {
                session.stats.attachIn += frameBytes(data)
            }
            runRelayActions(session, session.relayPath.feed(meta.role, data))
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
            const code = closeCode && closeCode >= 4000 ? closeCode : DESKTOP_CLOSE_ATTRIBUTIONS.peerGone.code
            teardownSession(session.sessionId, code, closeReason || 'peer gone')
        },
    }
}
