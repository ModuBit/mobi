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

import { describe, expect, test } from 'bun:test'
import { createDesktopBroker } from '../../src/desktop/broker'
import { createDesktopWebsocketHandlers, handleDesktopFetch, isDesktopPathname } from '../../src/desktop/transport'
import {
    DESKTOP_ATTACH_PATH,
    DESKTOP_OBSERVE_PATH,
    DESKTOP_WS_DATA_KEY,
    desktopAttachMetadataSchema,
} from '@mobi/shared'

/** 在临时端口上起一个仅含 desktop 分流的测试服务器（真实 WS 客户端直连） */
function startTestServer(broker: ReturnType<typeof createDesktopBroker>) {
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (req, server) => {
            const desktop = handleDesktopFetch(req, server, broker)
            if (desktop !== null) {
                return desktop
            }
            return new Response('not found', { status: 404 })
        },
        websocket: createDesktopWebsocketHandlers(broker),
    })
    return { server, url: `ws://127.0.0.1:${server.port}` }
}

/** 建立 attach 侧连接：反连 + 首帧 metadata（二进制帧），resolve 于 metadata 被接受 */
function connectAttach(
    url: string,
    ticket: string,
    metadata: unknown = { protocol: 'mobi-desktop-1', machineId: 'm1' },
): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${url}${DESKTOP_ATTACH_PATH}?ticket=${ticket}`)
        ws.binaryType = 'arraybuffer'
        ws.onopen = () => {
            ws.send(new TextEncoder().encode(JSON.stringify(metadata)))
            resolve(ws)
        }
        ws.onerror = () => reject(new Error('attach connect failed'))
    })
}

/** 建立 observe 侧连接，resolve 于 open */
function connectObserve(url: string, token: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${url}${DESKTOP_OBSERVE_PATH}?token=${token}`)
        ws.binaryType = 'arraybuffer'
        ws.onopen = () => resolve(ws)
        ws.onerror = () => reject(new Error('observe connect failed'))
    })
}

function nextMessage(ws: WebSocket): Promise<Uint8Array> {
    return new Promise((resolve) => {
        ws.onmessage = (event) => resolve(new Uint8Array(event.data as ArrayBuffer))
    })
}

function nextClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
        ws.onclose = (event) => resolve({ code: event.code, reason: event.reason })
    })
}

const TICKET_TTL_MS = 60_000

function makeBroker(overrides: Partial<Parameters<typeof createDesktopBroker>[0]> = {}) {
    return createDesktopBroker({ ttlMs: TICKET_TTL_MS, ...overrides })
}

async function makeActivePair(url: string, broker: ReturnType<typeof createDesktopBroker>) {
    const session = broker.watchSession('m1')
    const attach = await connectAttach(url, session.attachTicket)
    const observe = await connectObserve(url, session.observeToken)
    return { session, attach, observe }
}

describe('desktop transport: path 分流', () => {
    test('desktop 路径识别', () => {
        expect(isDesktopPathname(DESKTOP_ATTACH_PATH)).toBe(true)
        expect(isDesktopPathname(DESKTOP_OBSERVE_PATH)).toBe(true)
        expect(isDesktopPathname('/socket.io/')).toBe(false)
        expect(isDesktopPathname('/api/desktop/watch')).toBe(false)
    })
})

describe('desktop transport: 双向字节透传', () => {
    test('上游→下游：attach 先到、observe 后到，字节在两侧就绪后透传', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        // attach 先到：metadata 被接受后上游读取暂停，早期字节不丢
        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const received = nextMessage(observe)
        attach.send(new Uint8Array([0x52, 0x46, 0x42])) // "RFB"
        expect(await received).toEqual(new Uint8Array([0x52, 0x46, 0x42]))

        attach.close()
        observe.close()
    })

    test('下游→上游：浏览器帧透传到 cli 侧', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { attach, observe } = await makeActivePair(url, broker)

        const received = nextMessage(attach)
        observe.send(new Uint8Array([0x01, 0x02, 0x03]))
        expect(await received).toEqual(new Uint8Array([0x01, 0x02, 0x03]))

        attach.close()
        observe.close()
    })

    test('observe 先到、attach 后到，透传同样成立', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const observe = await connectObserve(url, session.observeToken)
        const attach = await connectAttach(url, session.attachTicket)

        const received = nextMessage(observe)
        attach.send(new Uint8Array([0x09]))
        expect(await received).toEqual(new Uint8Array([0x09]))

        attach.close()
        observe.close()
    })
})

describe('desktop transport: attach 票据校验', () => {
    test('无效 ticket 被拒绝升级', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        await expect(connectAttach(url, 'deadbeef'.repeat(6))).rejects.toThrow('attach connect failed')
    })

    test('ticket 只能使用一次（重放被拒）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        await connectAttach(url, session.attachTicket)

        await expect(connectAttach(url, session.attachTicket)).rejects.toThrow('attach connect failed')
    })

    test('过期 ticket 被拒绝', async () => {
        const broker = makeBroker({ ttlMs: 50 })
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        await Bun.sleep(60)

        await expect(connectAttach(url, session.attachTicket)).rejects.toThrow('attach connect failed')
    })

    test('metadata 不合法（machineId 不匹配）→ 连接被关闭、票据作废', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const ws = await connectAttach(url, session.attachTicket, {
            protocol: 'mobi-desktop-1',
            machineId: 'other-machine',
        })
        const closed = await nextClose(ws)
        expect(closed.code).toBe(1008)

        // 会话被拆除：observe token 也不可用
        await expect(connectObserve(url, session.observeToken)).rejects.toThrow('observe connect failed')
    })

    test('metadata 不合法（坏 JSON）→ 连接被关闭', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const ws = new WebSocket(`${url}${DESKTOP_ATTACH_PATH}?ticket=${session.attachTicket}`)
        ws.onopen = () => ws.send('not json')
        const closed = await nextClose(ws)
        expect(closed.code).toBe(1008)
    })

    test('metadata schema 校验通过（shared 契约一致性）', () => {
        const parsed = desktopAttachMetadataSchema.safeParse({ protocol: 'mobi-desktop-1', machineId: 'm1' })
        expect(parsed.success).toBe(true)
    })
})

describe('desktop transport: observe token 校验', () => {
    test('无效 token 被拒绝升级', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        await expect(connectObserve(url, 'deadbeef'.repeat(6))).rejects.toThrow('observe connect failed')
    })

    test('token 只能使用一次', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        await connectObserve(url, session.observeToken)

        await expect(connectObserve(url, session.observeToken)).rejects.toThrow('observe connect failed')
    })
})

describe('desktop transport: 会话生命周期', () => {
    test('同一 machineId 的 watch 抢占旧会话：旧两侧被关闭', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const first = broker.watchSession('m1')
        const attach1 = await connectAttach(url, first.attachTicket)
        const observe1 = await connectObserve(url, first.observeToken)

        const closedObserve = nextClose(observe1)
        broker.watchSession('m1') // 抢占

        const closed = await closedObserve
        expect(closed.code).toBe(4000)
        expect(attach1.readyState).not.toBe(WebSocket.OPEN)
    })

    test('downstream 断开 → upstream 关闭、observe token 作废', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const attachClosed = nextClose(attach)
        observe.close()
        const closed = await attachClosed
        expect(closed.code).toBe(4001)

        // 会话移除：旧 token 不可再用
        await expect(connectObserve(url, session.observeToken)).rejects.toThrow('observe connect failed')
    })

    test('watch 后 attach 超时未到 → 会话过期，observe token 不可用', async () => {
        const broker = makeBroker({ ttlMs: 50 })
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        await Bun.sleep(80)

        await expect(connectObserve(url, session.observeToken)).rejects.toThrow('observe connect failed')
    })

    test('broker 列出活跃会话（含 machineId 与开始时间）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        expect(broker.listSessions()).toHaveLength(0)
        const session = broker.watchSession('m1')
        const listed = broker.listSessions()
        expect(listed).toHaveLength(1)
        expect(listed[0]).toMatchObject({ machineId: 'm1' })
        expect(listed[0].startedAtMs).toBeGreaterThan(0)

        // teardown 后清空
        broker.teardownSession(session.sessionId, 4000, 'test')
        expect(broker.listSessions()).toHaveLength(0)

        url // 服务器随测试进程退出
    })
})

describe('desktop transport: data 标记隔离', () => {
    test('DESKTOP_WS_DATA_KEY 存在于 shared（与 engine data 形状不冲突）', () => {
        expect(DESKTOP_WS_DATA_KEY).toBe('__mobiDesktop')
    })
})
