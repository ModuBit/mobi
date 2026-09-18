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

import { describe, expect, test, afterEach, beforeEach, vi } from 'vitest'
import net from 'node:net'
import { runDesktopStreamTransport } from '../../src/desktop/streamTransport'

/**
 * cli 侧 transport 测试：WS 协议语义（upgrade/透传/票据）由 hub 包 transport.test
 * （bun 运行器 + Bun.serve）覆盖；这里 stub 全局 WebSocket，专测 cli 侧自身行为——
 * metadata 先行时序、vncPassword 上行、target 拒连的 4003 归因。
 */

/** 可操纵的假 WebSocket：记录 send/close，手动派发 open */
class FakeWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    readyState = FakeWebSocket.CONNECTING
    binaryType = 'arraybuffer'
    bufferedAmount = 0

    sent: Uint8Array[] = []
    closeCall: { code?: number; reason?: string } | undefined

    static instances: FakeWebSocket[] = []

    constructor(url: string) {
        super()
        void url
        FakeWebSocket.instances.push(this)
    }

    send(data: ArrayBuffer | Uint8Array): void {
        this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data))
    }

    close(code?: number, reason?: string): void {
        if (this.readyState === FakeWebSocket.CLOSED) return
        this.readyState = FakeWebSocket.CLOSED
        this.closeCall = { code, reason }
        this.dispatchEvent(new Event('close'))
    }

    /** 模拟服务端 accept：连接打开 */
    serverOpen(): void {
        this.readyState = FakeWebSocket.OPEN
        this.dispatchEvent(new Event('open'))
    }

    /** 模拟服务端下发二进制帧 */
    serverMessage(data: Uint8Array): void {
        this.dispatchEvent(new MessageEvent('message', { data: data.slice().buffer }))
    }
}

/** 模拟 macOS VNC：接受连接后立即发版本串（验证早期字节不丢），并收集 ws 侧来的帧 */
function startFakeVncTarget() {
    const receivedFromWs: Buffer[] = []
    const sockets: net.Socket[] = []
    let notifyData: (() => void) | undefined
    const server = net.createServer((sock) => {
        sockets.push(sock)
        sock.write('RFB 003.008\n')
        sock.on('data', (chunk: Buffer) => {
            receivedFromWs.push(chunk)
            notifyData?.()
        })
    })
    return {
        listen: () =>
            new Promise<number>((resolve) => {
                server.listen(0, '127.0.0.1', () => {
                    resolve((server.address() as net.AddressInfo).port)
                })
            }),
        receivedFromWs,
        onData: (cb: () => void) => {
            notifyData = cb
        },
        stop: () => {
            for (const sock of sockets) {
                sock.destroy()
            }
            server.close()
        },
    }
}

/** 等待 transport 建立连接；返回连接（未 open） */
async function waitTransportConnect(): Promise<FakeWebSocket> {
    // transport 在同步流程内 new WebSocket → 等一个微任务确保实例已登记
    await Promise.resolve()
    const ws = FakeWebSocket.instances.at(-1)
    if (!ws) throw new Error('transport 未创建 WebSocket')
    return ws
}

function makeParams(overrides: Partial<Parameters<typeof runDesktopStreamTransport>[0]> = {}) {
    return {
        gatewayUrl: 'http://127.0.0.1:2222',
        machineId: 'test-machine-1',
        ticket: 'a'.repeat(48),
        attachPath: '/desktop/attach',
        target: { host: '127.0.0.1', port: 5900 },
        signal: new AbortController().signal,
        ...overrides,
    }
}

describe('runDesktopStreamTransport', () => {
    beforeEach(() => {
        vi.stubGlobal('WebSocket', FakeWebSocket)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        FakeWebSocket.instances.length = 0
    })

    test('WS open 后 metadata 首帧先于 VNC 早期字节（版本串不丢）', async () => {
        const vnc = startFakeVncTarget()
        const vncPort = await vnc.listen()

        const abortController = new AbortController()
        const handle = runDesktopStreamTransport(
            makeParams({ target: { host: '127.0.0.1', port: vncPort }, signal: abortController.signal }),
        )
        const ws = await waitTransportConnect()
        ws.serverOpen()

        // 帧 1 = metadata（二进制 JSON），帧 2 = macOS 连接后立即发出的版本串
        await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(2))
        expect(JSON.parse(new TextDecoder().decode(ws.sent[0]))).toEqual({
            protocol: 'mobi-desktop-1',
            machineId: 'test-machine-1',
        })
        expect(new TextDecoder().decode(ws.sent[1])).toBe('RFB 003.008\n')

        // hub → cli 方向：ws 帧透传到本机 VNC
        const gotData = new Promise<void>((resolve) => vnc.onData(resolve))
        ws.serverMessage(new Uint8Array([0x01]))
        await gotData
        expect(vnc.receivedFromWs.some((chunk) => chunk.includes(0x01))).toBe(true)

        // abort 收束流
        const settled = handle.done
        abortController.abort()
        await settled
        expect(handle.trigger).toBe('aborted')

        vnc.stop()
    })

    test('params 带 vncPassword 时随 metadata 上行，供 hub 代认证', async () => {
        const handle = runDesktopStreamTransport(makeParams({ vncPassword: 'secret1' }))
        const ws = await waitTransportConnect()
        ws.serverOpen()

        await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThanOrEqual(1))
        expect(JSON.parse(new TextDecoder().decode(ws.sent[0]))).toEqual({
            protocol: 'mobi-desktop-1',
            machineId: 'test-machine-1',
            vncPassword: 'secret1',
        })

        ws.close()
        await handle.done
    })

    test('本机 VNC 拒连 → 流结束且归因 target-connect-failed，ws 以 4003 关闭', async () => {
        const handle = runDesktopStreamTransport(
            makeParams({ target: { host: '127.0.0.1', port: 1 /* 无监听 */ } }),
        )
        const ws = await waitTransportConnect()
        ws.serverOpen()

        await handle.done
        expect(handle.trigger).toBe('target-connect-failed')
        expect(ws.closeCall?.code).toBe(4003)
        expect(ws.closeCall?.reason).toBe('upstream unavailable')
    })
})
