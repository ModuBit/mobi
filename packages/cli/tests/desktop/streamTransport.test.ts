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
import net from 'node:net'
import { runDesktopStreamTransport, hubWsUrl } from '../../src/desktop/streamTransport'

/** 模拟 macOS VNC：接受连接后立即发版本串（验证早期字节不丢），并收集 ws 侧来的帧 */
function startFakeVncTarget() {
    const receivedFromWs: Buffer[] = []
    let notifyData: (() => void) | undefined
    const server = net.createServer((sock) => {
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
        stop: () => server.close(),
    }
}

/** 模拟 hub attach 侧：upgrade 后收集 ws 帧，并可向 cli 方向发帧 */
function startFakeHub() {
    const messages: (Uint8Array | string)[] = []
    let notifyMessage: (() => void) | undefined
    let serverWs: WebSocket | undefined
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (req, srv) => {
            if (new URL(req.url).pathname !== '/desktop/attach') {
                return new Response('nf', { status: 404 })
            }
            srv.upgrade(req, { data: {} })
            return undefined
        },
        websocket: {
            open(ws) {
                serverWs = ws as WebSocket
            },
            message(ws, message) {
                messages.push(message as Uint8Array)
                notifyMessage?.()
            },
            close() {},
        },
    })
    return {
        port: server.port,
        messages,
        waitForMessages: async (count: number) => {
            if (messages.length >= count) {
                return
            }
            await new Promise<void>((resolve) => {
                notifyMessage = () => {
                    if (messages.length >= count) {
                        resolve()
                    }
                }
            })
        },
        sendToCli: (data: Uint8Array) => {
            serverWs?.send(data)
        },
        stop: () => server.stop(true),
    }
}

describe('runDesktopStreamTransport', () => {
    test('metadata 首帧先于 RFB 字节到达 hub，早期版本串不丢', async () => {
        const vnc = startFakeVncTarget()
        const vncPort = await vnc.listen()
        const hub = startFakeHub()

        const abortController = new AbortController()
        const handle = runDesktopStreamTransport({
            gatewayUrl: `http://127.0.0.1:${hub.port}`,
            machineId: 'test-machine-1',
            ticket: 'a'.repeat(48),
            attachPath: '/desktop/attach',
            target: { host: '127.0.0.1', port: vncPort },
            signal: abortController.signal,
        })

        // 帧 1 = metadata（二进制 JSON），帧 2 = macOS 立即发出的版本串
        await hub.waitForMessages(2)
        const metadata = JSON.parse(new TextDecoder().decode(hub.messages[0] as Uint8Array))
        expect(metadata).toEqual({ protocol: 'mobi-desktop-1', machineId: 'test-machine-1' })
        expect(new TextDecoder().decode(hub.messages[1] as Uint8Array)).toBe('RFB 003.008\n')

        // hub → cli 方向透传到本机 VNC
        const gotData = new Promise<void>((resolve) => vnc.onData(resolve))
        hub.sendToCli(new Uint8Array([0x01]))
        await gotData
        expect(vnc.receivedFromWs.some((chunk) => chunk.includes(0x01))).toBe(true)

        // abort 收束流
        const settled = handle.done
        abortController.abort()
        await settled
        expect(handle.trigger).toBe('aborted')

        vnc.stop()
        hub.stop()
    })

    test('本机 VNC 拒连 → 流结束且归因 target-connect-failed，ws 关闭', async () => {
        const hub = startFakeHub()

        const handle = runDesktopStreamTransport({
            gatewayUrl: `http://127.0.0.1:${hub.port}`,
            machineId: 'test-machine-1',
            ticket: 'a'.repeat(48),
            attachPath: '/desktop/attach',
            target: { host: '127.0.0.1', port: 1 /* 无监听 */ },
            signal: new AbortController().signal,
        })

        await handle.done
        expect(handle.trigger).toBe('target-connect-failed')
        hub.stop()
    })

    test('hub 地址转换：http → ws', () => {
        expect(hubWsUrl('http://localhost:2222')).toBe('ws://localhost:2222')
        expect(hubWsUrl('https://hub.example.com')).toBe('wss://hub.example.com')
    })
})
