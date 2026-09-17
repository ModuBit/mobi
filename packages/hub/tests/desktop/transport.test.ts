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
import { vncAuthResponse, encodeAuthFailure } from '../../src/desktop/rfbPreauth'
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

/**
 * 走一遍 RFB 3.8 None 认证握手（attach 侧扮演 VNC server，observe 侧扮演 noVNC）。
 * 两侧就绪后 hub 会建立握手代理，握手完成前字节不透传——此 helper 把会话推进到 live。
 */
async function performRfbNoneHandshake(attach: WebSocket, observe: WebSocket): Promise<void> {
    const rfb38 = new TextEncoder().encode('RFB 003.008\n')
    attach.send(rfb38) // server version → 浏览器
    expect(await nextMessage(observe)).toEqual(rfb38)
    observe.send(rfb38) // client version → 上游
    expect(await nextMessage(attach)).toEqual(rfb38)
    attach.send(new Uint8Array([1, 1])) // None-only offer
    expect(await nextMessage(observe)).toEqual(new Uint8Array([1, 1]))
    observe.send(new Uint8Array([1])) // 浏览器选 None
    expect(await nextMessage(attach)).toEqual(new Uint8Array([1]))
    attach.send(new Uint8Array([0, 0, 0, 0])) // SecurityResult OK
    expect(await nextMessage(observe)).toEqual(new Uint8Array([0, 0, 0, 0]))
}

/**
 * 走一遍上游 VNC-auth 的握手：浏览器全程只看到 None-only，挑战由 hub 代答。
 * metadata 须携带 vncPassword。返回 hub 代答的 8 字节应答供断言。
 */
async function performRfbVncHandshake(attach: WebSocket, observe: WebSocket): Promise<Uint8Array> {
    const rfb38 = new TextEncoder().encode('RFB 003.008\n')
    attach.send(rfb38)
    expect(await nextMessage(observe)).toEqual(rfb38)
    observe.send(rfb38)
    expect(await nextMessage(attach)).toEqual(rfb38)

    attach.send(new Uint8Array([1, 2])) // 上游仅提供 VNC-auth
    // 浏览器看到的仍是重写后的 None-only offer
    expect(await nextMessage(observe)).toEqual(new Uint8Array([1, 1]))

    observe.send(new Uint8Array([1])) // 浏览器选 None → hub 对上游发 VNC-auth
    expect(await nextMessage(attach)).toEqual(new Uint8Array([2]))

    const challenge = new Uint8Array(16).fill(0x5a)
    attach.send(challenge)
    const response = await nextMessage(attach)
    expect(response).toHaveLength(8)
    return response
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

        // RFB 握手完成后进入纯透传
        await performRfbNoneHandshake(attach, observe)

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
        await performRfbNoneHandshake(attach, observe)

        // 观察侧上行已过输入过滤器（迭代 2）：须为合法 RFB 消息才放行，
        // 这里用 SetEncodings 承载任意载荷断言字节完整性
        const received = nextMessage(attach)
        observe.send(new Uint8Array([2, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]))
        expect(await received).toEqual(new Uint8Array([2, 0, 0, 1, 0xff, 0xff, 0xff, 0xff]))

        attach.close()
        observe.close()
    })

    test('observe 先到、attach 后到，透传同样成立', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const observe = await connectObserve(url, session.observeToken)
        const attach = await connectAttach(url, session.attachTicket)

        await performRfbNoneHandshake(attach, observe)

        const received = nextMessage(observe)
        attach.send(new Uint8Array([0x09]))
        expect(await received).toEqual(new Uint8Array([0x09]))

        attach.close()
        observe.close()
    })
})

describe('desktop transport: hub 代认证（上游 VNC-auth）', () => {
    test('上游为 Apple 魔改版本 003.889（macOS 屏幕共享实况）：按 3.8 时序正常代认证', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket, {
            protocol: 'mobi-desktop-1',
            machineId: 'm1',
            vncPassword: 'secret1',
        })
        const observe = await connectObserve(url, session.observeToken)

        // macOS 实况：服务器回 003.889，浏览器收到的仍是 3.8、回复 3.8
        const apple389 = new TextEncoder().encode('RFB 003.889\n')
        attach.send(apple389)
        expect(await nextMessage(observe)).toEqual(new TextEncoder().encode('RFB 003.008\n'))
        observe.send(new TextEncoder().encode('RFB 003.008\n'))
        expect(await nextMessage(attach)).toEqual(new TextEncoder().encode('RFB 003.008\n'))

        attach.send(new Uint8Array([4, 0x1e, 0x21, 0x24, 0x02])) // Apple 实测的类型表（含 VNC-auth）
        expect(await nextMessage(observe)).toEqual(new Uint8Array([1, 1]))
        observe.send(new Uint8Array([1]))
        expect(await nextMessage(attach)).toEqual(new Uint8Array([2]))

        attach.send(new Uint8Array(16).fill(0x5a))
        // Apple 889 的 VNC-auth：应答是整个 16 字节 challenge 的 DES 密文
        const response = await nextMessage(attach)
        expect(response).toEqual(vncAuthResponse(new Uint8Array(16).fill(0x5a), 'secret1'))
        expect(response).toHaveLength(16)

        attach.send(new Uint8Array([0, 0, 0, 0]))
        expect(await nextMessage(observe)).toEqual(new Uint8Array([0, 0, 0, 0]))
        attach.close()
        observe.close()
    })

    test('上游版本低于 3.8 → 拒绝', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const observeClosed = nextClose(observe)
        attach.send(new TextEncoder().encode('RFB 003.007\n'))
        const closed = await observeClosed
        expect(closed.code).toBe(1008)
        expect(closed.reason).toBe('unsupported rfb version')
    })

    test('metadata 携带密码：hub 代答 DES 挑战，浏览器全程只见 None', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket, {
            protocol: 'mobi-desktop-1',
            machineId: 'm1',
            vncPassword: 'secret1',
        })
        const observe = await connectObserve(url, session.observeToken)

        const response = await performRfbVncHandshake(attach, observe)
        // 代答与参考实现一致（密码不出 hub：挑战发给 attach 侧，应答由 hub 算出）；
        // 标准 RFB 3.8 上游只加密前 8 字节挑战
        expect(response).toEqual(vncAuthResponse(new Uint8Array(8).fill(0x5a), 'secret1'))
        expect(response).toHaveLength(8)

        // SecurityResult OK → 进入纯透传
        attach.send(new Uint8Array([0, 0, 0, 0]))
        expect(await nextMessage(observe)).toEqual(new Uint8Array([0, 0, 0, 0]))
        const received = nextMessage(observe)
        attach.send(new Uint8Array([0xaa]))
        expect(await received).toEqual(new Uint8Array([0xaa]))

        attach.close()
        observe.close()
    })

    test('密码错误：浏览器收到标准失败序列（含 reason），两侧随后关闭', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket, {
            protocol: 'mobi-desktop-1',
            machineId: 'm1',
            vncPassword: 'wrongpwd',
        })
        const observe = await connectObserve(url, session.observeToken)

        await performRfbVncHandshake(attach, observe)

        // 上游判定应答错误 → hub 向浏览器发 RFB 3.8 失败序列后拆会话
        attach.send(new Uint8Array([0, 0, 0, 1]))
        expect(await nextMessage(observe)).toEqual(encodeAuthFailure('vnc auth failed'))
        const closed = await Promise.all([nextClose(attach), nextClose(observe)])
        for (const { code, reason } of closed) {
            expect(code).toBe(1008)
            expect(reason).toBe('vnc auth failed')
        }
    })

    test('上游 VNC-auth 但密码未配置：握手失败拆会话', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const rfb38 = new TextEncoder().encode('RFB 003.008\n')
        attach.send(rfb38)
        expect(await nextMessage(observe)).toEqual(rfb38)
        observe.send(rfb38)
        expect(await nextMessage(attach)).toEqual(rfb38)
        attach.send(new Uint8Array([1, 2])) // 上游仅提供 VNC-auth

        const closed = await Promise.all([nextClose(attach), nextClose(observe)])
        for (const { code, reason } of closed) {
            expect(code).toBe(1008)
            expect(reason).toBe('vnc password not configured')
        }
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

    test('upstream 异常断开 → downstream 被通知关闭（与 downstream 断开对称）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const observeClosed = nextClose(observe)
        attach.close()
        const closed = await observeClosed
        expect(closed.code).toBe(4001)
        expect(closed.reason).toBe('peer gone')
    })

    test('cli 侧 4003 上游不可用 → 观看侧收到 4003 与归因（供 Provider 不重连）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        const observeClosed = nextClose(observe)
        attach.close(4003, 'upstream unavailable')
        const closed = await observeClosed
        expect(closed.code).toBe(4003)
        expect(closed.reason).toBe('upstream unavailable')
    })

    test('upstream 断开 → attach ticket 同样作废（票据全路径清理）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)
        attach.close()
        await nextClose(observe)

        // 未兑换的 attach ticket 已随会话作废（重放被拒）
        await expect(connectAttach(url, session.attachTicket)).rejects.toThrow('attach connect failed')
    })

    test('attach 开链后 observe 超时未到 → 拆会话，cli 侧被关（防泵空跑）', async () => {
        const broker = makeBroker({ ttlMs: 50 })
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)

        const attachClosed = nextClose(attach)
        await Bun.sleep(120) // observe 一直不来，超过兜底时效
        const closed = await attachClosed
        expect(closed.code).toBe(4001)
        expect(closed.reason).toBe('observe timeout')
    })

    test('observe 到达后不起 observe 超时（正常会话不被误拆）', async () => {
        const broker = makeBroker({ ttlMs: 50 })
        const { url } = startTestServer(broker)

        const session = broker.watchSession('m1')
        const attach = await connectAttach(url, session.attachTicket)
        const observe = await connectObserve(url, session.observeToken)

        await Bun.sleep(120) // 远超兜底时效：两侧仍 OPEN
        expect(attach.readyState).toBe(WebSocket.OPEN)
        expect(observe.readyState).toBe(WebSocket.OPEN)

        attach.close()
        observe.close()
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

// —— 控制权（迭代 2）：过滤器 + 状态机的外部行为 ——

/** 构造标准 RFB client 消息（与 rfbInputFilter.test 的形状表一致） */
function clientMsg(type: number, body: number[] = []): Uint8Array {
    return new Uint8Array([type, ...body])
}
function keyEvent(key = 0x41): Uint8Array {
    return clientMsg(4, [1, 0, 0, 0, 0, 0, key])
}
function pointerEvent(): Uint8Array {
    return clientMsg(5, [1, 0, 1, 0, 2])
}
function fbUpdateReq(): Uint8Array {
    return clientMsg(3, [1, 0, 0, 0, 0, 0, 0, 0, 0])
}
function setDesktopSize(): Uint8Array {
    return clientMsg(251, [0, 7, 128, 0, 1, 0, ...new Uint8Array(4)])
}

/** 断言 attach 侧在 ms 内收不到任何字节（view-only 剥除的观测方式） */
async function expectSilence(ws: WebSocket, ms = 80): Promise<void> {
    const received = nextMessage(ws).then(() => 'received' as const)
    const silent = Bun.sleep(ms).then(() => 'silent' as const)
    expect(await Promise.race([received, silent])).toBe('silent')
}

describe('desktop transport: 控制权过滤与状态机', () => {
    async function makeLivePair(url: string, broker: ReturnType<typeof createDesktopBroker>) {
        const { session, attach, observe } = await makeActivePair(url, broker)
        await performRfbNoneHandshake(attach, observe)
        return { session, attach, observe }
    }

    test('view-only：输入类消息到不了上游，观看必需消息照常通过', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { attach, observe } = await makeLivePair(url, broker)

        observe.send(keyEvent())
        observe.send(pointerEvent())
        await expectSilence(attach)

        const received = nextMessage(attach)
        observe.send(fbUpdateReq())
        expect(await received).toEqual(fbUpdateReq())

        attach.close()
        observe.close()
    })

    test('授予后输入类放行（SetDesktopSize 恒剥），退出后恢复剥除', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { session, attach, observe } = await makeLivePair(url, broker)

        expect(broker.grantControl('m1')).toMatchObject({ control: 'controlled' })
        const key = nextMessage(attach)
        observe.send(keyEvent())
        expect(await key).toEqual(keyEvent())

        observe.send(setDesktopSize())
        await expectSilence(attach)

        broker.releaseControl('m1', 'test release')
        observe.send(keyEvent(0x42))
        await expectSilence(attach)

        attach.close()
        observe.close()
    })

    test('授予幂等；无会话/已拆除返回 null', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { session } = await makeLivePair(url, broker)

        expect(broker.grantControl('m1')?.control).toBe('controlled')
        expect(broker.grantControl('m1')?.control).toBe('controlled')
        expect(broker.grantControl('no-such-machine')).toBeNull()
        expect(broker.releaseControl('no-such-machine', 'x')).toBeNull()

        broker.teardownSession(session.sessionId, 4002, 'test')
        expect(broker.grantControl('m1')).toBeNull()

        url // 服务器随测试进程退出
    })

    test('控制权空闲超时自动回落：流保持存活，仅恢复剥除', async () => {
        const changes: Array<{ control: string }> = []
        const broker = makeBroker({ controlIdleMs: 60, onControlChange: (c) => changes.push(c) })
        const { url } = startTestServer(broker)
        const { session, attach, observe } = await makeLivePair(url, broker)

        broker.grantControl('m1')
        await Bun.sleep(120) // 超过空闲时效

        observe.send(keyEvent())
        await expectSilence(attach)

        // 回落不拆流：观看必需消息照常
        const received = nextMessage(attach)
        observe.send(fbUpdateReq())
        expect(await received).toEqual(fbUpdateReq())

        expect(changes).toMatchObject([
            { control: 'controlled' },
            { control: 'view-only' },
        ])

        attach.close()
        observe.close()
    })

    test('放行的输入消息重置空闲计时（持续操作不掉控制权）', async () => {
        const changes: string[] = []
        const broker = makeBroker({ controlIdleMs: 80, onControlChange: (c) => changes.push(c.control) })
        const { url } = startTestServer(broker)
        const { session, attach, observe } = await makeLivePair(url, broker)

        broker.grantControl('m1')
        // 以 40ms 间隔持续输入，总时长超过 80ms 时效
        for (let i = 0; i < 4; i++) {
            await Bun.sleep(40)
            observe.send(keyEvent(0x30 + i))
        }
        await Bun.sleep(40)
        expect(changes).toEqual(['controlled'])
        expect(broker.listSessions()[0].control).toBe('controlled')

        broker.releaseControl('m1', 'end of test')
        attach.close()
        observe.close()
    })

    test('上行字节解析错位（未知消息类型）→ 协议错误拆会话', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { attach, observe } = await makeLivePair(url, broker)

        const closed = Promise.all([nextClose(attach), nextClose(observe)])
        observe.send(clientMsg(0x7f))
        const results = await closed
        for (const { code, reason } of results) {
            expect(code).toBe(1008)
            expect(reason).toBe('rfb input parse failed')
        }
    })

    test('streams 列表携带控制权状态（初次对齐数据源）', async () => {
        const broker = makeBroker()
        const { url } = startTestServer(broker)
        const { session } = await makeLivePair(url, broker)

        expect(broker.listSessions()[0]).toMatchObject({ sessionId: session.sessionId, control: 'view-only' })
        broker.grantControl('m1')
        expect(broker.listSessions()[0].control).toBe('controlled')

        url // 服务器随测试进程退出
    })
})
