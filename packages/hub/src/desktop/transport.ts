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
 * Desktop raw WS 与 Bun.serve 的组合胶水。
 *
 * hub 的 Bun.serve 同时服务三类流量：Hono HTTP、Socket.IO（bun-engine）、
 * desktop raw WS。engine 拥有自己的 websocket handlers，desktop 无法单独注册，
 * 因此这里提供两个组合件：
 * - handleDesktopFetch：顶层 fetch 内先于 engine 分流 desktop 路径（校验票据 + upgrade）
 * - composeWebsocketHandlers：按 ws.data 标记把 open/message/close 分派给 engine 或 desktop
 *
 * desktop 侧鉴权即票据持有：observe token 仅在 watch API（JWT cookie 鉴权）通过后
 * 签发，attach ticket 仅经 hub→cli 的已鉴权 RPC 下发。
 */

import type { ServerWebSocket } from 'bun'
import type { WebSocketHandler } from 'bun'
import {
    DESKTOP_ATTACH_PATH,
    DESKTOP_OBSERVE_PATH,
    DESKTOP_WS_DATA_KEY,
    desktopStreamRequestSchema,
} from '@mobi/shared'
import type { DesktopBroker } from './broker'

/** desktop 路径是否由本模块处理（顶层 fetch 分流依据；/api 路由不算） */
export function isDesktopPathname(pathname: string): boolean {
    return pathname === DESKTOP_ATTACH_PATH || pathname === DESKTOP_OBSERVE_PATH
}

/**
 * desktop 路径的 fetch 入口。
 * 返回 null 表示非 desktop 路径（调用方继续走 engine/app）；
 * 返回 undefined 表示 upgrade 已受理；其余为拒绝响应（401/426）。
 */
export function handleDesktopFetch(
    req: Request,
    server: { upgrade(req: Request, options?: { data?: unknown }): boolean },
    broker: DesktopBroker,
): Response | undefined | null {
    const url = new URL(req.url)
    if (!isDesktopPathname(url.pathname)) {
        return null
    }

    const isAttach = url.pathname === DESKTOP_ATTACH_PATH
    const credential = url.searchParams.get(isAttach ? 'ticket' : 'token') ?? ''
    const sessionId = isAttach
        ? broker.consumeAttachTicket(credential)
        : broker.consumeObserveToken(credential)
    if (!sessionId) {
        return new Response('invalid desktop credential', { status: 401 })
    }

    if (!req.headers.get('upgrade')) {
        return new Response('expected websocket upgrade', { status: 426 })
    }

    const upgraded = server.upgrade(req, {
        data: { [DESKTOP_WS_DATA_KEY]: { role: isAttach ? 'attach' : 'observe', sessionId } },
    })
    if (!upgraded) {
        return new Response('upgrade failed', { status: 500 })
    }
    // upgrade 成功后 Bun 要求不返回 Response（连接已移交 websocket handler）
    return undefined
}

/** desktop 侧独立的 websocket handlers（测试可直接挂；生产经 compose 组合） */
export function createDesktopWebsocketHandlers(
    broker: DesktopBroker,
): WebSocketHandler<Record<string, unknown>> {
    return {
        open(ws) {
            broker.onSocketOpen(ws as never)
        },
        message(ws, message) {
            broker.onSocketMessage(ws as never, message)
        },
        close(ws, code, reason) {
            broker.onSocketClose(ws as never, code, reason)
        },
    }
}

/**
 * 组合 engine 与 desktop 的 websocket handlers：按 ws.data 中的专属 key 分派。
 * maxPayloadLength 取两者较大值（engine 约束 socket.io 帧，desktop 需放行 RFB 中继帧）。
 */
export function composeWebsocketHandlers<TData>(
    engine: WebSocketHandler<TData> & { maxPayloadLength?: number },
    desktop: WebSocketHandler<Record<string, unknown>>,
    extraMaxPayload = 0,
): WebSocketHandler<TData> & { maxPayloadLength: number } {
    return {
        open(ws) {
            if (isDesktopSocket(ws)) {
                desktop.open?.(ws as never)
                return
            }
            engine.open?.(ws)
        },
        message(ws, message) {
            if (isDesktopSocket(ws)) {
                desktop.message?.(ws as never, message as never)
                return
            }
            engine.message?.(ws, message)
        },
        close(ws, code, reason) {
            if (isDesktopSocket(ws)) {
                desktop.close?.(ws as never, code, reason)
                return
            }
            engine.close?.(ws, code, reason)
        },
        maxPayloadLength: Math.max(engine.maxPayloadLength ?? 0, extraMaxPayload),
    }
}

function isDesktopSocket(ws: ServerWebSocket<unknown>): boolean {
    const data = ws.data as Record<string, unknown> | undefined
    return Boolean(data && DESKTOP_WS_DATA_KEY in data && data[DESKTOP_WS_DATA_KEY])
}

/** attach metadata 的 RPC 参数校验（hub 路由下发与 cli 侧共用形状，运行时守卫在 cli） */
export function parseDesktopStreamRequest(params: unknown) {
    return desktopStreamRequestSchema.safeParse(params)
}
