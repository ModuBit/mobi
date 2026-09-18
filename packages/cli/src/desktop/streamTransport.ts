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
 * Desktop 流传输（cli 侧）：hub attach WS ↔ 本机 VNC（macOS 屏幕共享 RFB）。
 *
 * 顺序（openclaw 同款时序）：先 attach WS（票据在 upgrade 时被 hub 兑换，
 * 本机拒连能立刻关闭已宣称的票据），再连本机 VNC；连接后先 pause TCP 侧
 * （macOS 连接后立即发版本串），metadata 首帧送达 hub 后再开泵，保证
 * RFB 首字节不丢。hub 只透传字节；RFB 协商发生在浏览器 noVNC 与 macOS 之间。
 */

import net from 'node:net'
import { DESKTOP_CLOSE_ATTRIBUTIONS, desktopWsOrigin, type DesktopAttachMetadata } from '@mobi/shared'
import { duplexEndpoint, createStreamPump, type PumpEndpoint } from './pump'

/**
 * Bun 客户端 WebSocket → PumpEndpoint。
 *
 * 背压说明（重要）：Bun 客户端 WebSocket 的 bufferedAmount 只在 send 调用时增长、
 * 从不随后台 flush 衰减（探针实测恒定卡死），因此无法用它做可靠的背压水位——
 * 这里不做暂停判定、send 恒成功，洪峰由 Bun 内部缓冲吸收（首帧全屏 raw 约 20-60MB、
 * 本机回环一次性），终局背压由 hub 侧的 64MB 中继缓冲兜底（超限拆会话）。
 * onDrain 保留空实现以维持 PumpEndpoint 形状（pump 的恢复回调不会触发）。
 */
export function bunWsClientEndpoint(ws: WebSocket): PumpEndpoint {
    return {
        send(data) {
            if (ws.readyState !== WebSocket.OPEN) {
                return false
            }
            ws.send(data)
            return true
        },
        pause() {
            if (typeof ws.pause === 'function') {
                ws.pause()
            }
        },
        resume() {
            if (typeof ws.resume === 'function') {
                ws.resume()
            }
        },
        onDrain() {},
        close: () => ws.close(1000, 'cli teardown'),
        isOpen: () => ws.readyState === WebSocket.OPEN,
    }
}

export type DesktopStreamTeardownTrigger =
    | 'ws-open-failed'
    | 'target-connect-failed'
    | 'ws-closed'
    | 'target-closed'
    | 'aborted'

export interface DesktopStreamHandle {
    done: Promise<void>
    /** teardown 归因（关闭日志用） */
    readonly trigger: DesktopStreamTeardownTrigger | undefined
}

/**
 * 建立并运行一条 desktop 流直到任一侧关闭或 abort。
 * resolve 于流结束（含 abort/错误路径——失败原因看 trigger 与日志），不 reject。
 * signal 可选：当前调用方（desktop-stream RPC）无主动取消通道，缺省即不挂 abort。
 */
export function runDesktopStreamTransport(params: {
    gatewayUrl: string
    machineId: string
    ticket: string
    attachPath: string
    target: { host: string; port: number }
    /** VNC 密码（读自身 settings；随 metadata 上行供 hub 代认证，可选） */
    vncPassword?: string
    signal?: AbortSignal
    log?: (message: string, data?: unknown) => void
}): DesktopStreamHandle {
    const { log = () => undefined } = params
    let teardownTrigger: DesktopStreamTeardownTrigger | undefined

    const done = (async (): Promise<void> => {
        // 1. attach WS：票据在 upgrade 时被 hub 兑换
        const wsUrl = `${desktopWsOrigin(params.gatewayUrl)}${params.attachPath}?ticket=${encodeURIComponent(params.ticket)}`
        const ws = new WebSocket(wsUrl)
        ws.binaryType = 'arraybuffer'

        const opened = await new Promise<boolean>((resolve) => {
            const onOpen = () => finish(true)
            const onError = () => finish(false)
            const finish = (ok: boolean) => {
                ws.removeEventListener('open', onOpen)
                ws.removeEventListener('error', onError)
                resolve(ok)
            }
            ws.addEventListener('open', onOpen)
            ws.addEventListener('error', onError)
        })
        if (!opened) {
            teardownTrigger = 'ws-open-failed'
            return
        }

        // 2. 本机 VNC：拒连则关闭已宣称的 attach（hub 侧会话随之拆除）
        const socket = await new Promise<net.Socket | null>((resolve) => {
            const sock = net.createConnection({ host: params.target.host, port: params.target.port })
            // macOS VNC 连接后立即发版本串：metadata 送达前暂停读取防丢
            sock.pause()
            sock.once('connect', () => resolve(sock))
            sock.once('error', () => resolve(null))
        })
        if (!socket) {
            teardownTrigger = 'target-connect-failed'
            // 4003 上游不可用：hub 透传给观看侧，Provider 归因展示且不自动重连
            // （否则「屏幕共享没开」会诱发观看端 watch/反连的快速循环）
            ws.close(DESKTOP_CLOSE_ATTRIBUTIONS.upstreamUnavailable.code, DESKTOP_CLOSE_ATTRIBUTIONS.upstreamUnavailable.prose)
            return
        }

        // 3. metadata 首帧（二进制 JSON）：hub 校验通过前不会向浏览器透传。
        // vncPassword 供 hub 代答 VNC 挑战（openclaw 同款），仅内存持有不落日志
        const metadata: DesktopAttachMetadata = {
            protocol: 'mobi-desktop-1',
            machineId: params.machineId,
            ...(params.vncPassword ? { vncPassword: params.vncPassword } : {}),
        }
        ws.send(new TextEncoder().encode(JSON.stringify(metadata)))

        // 4. 开泵：两侧数据事件接入泵（a=ws，b=TCP）。Buffer 本身是 Uint8Array，直接入泵免拷贝
        const pump = createStreamPump(bunWsClientEndpoint(ws), duplexEndpoint(socket))
        socket.on('data', (chunk: Buffer) => pump.feed('b', chunk))
        ws.addEventListener('message', (event) => {
            const data = (event as MessageEvent).data
            const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
            pump.feed('a', bytes)
        })
        pump.onTeardown((reason) => {
            log(`desktop stream ended: ${reason}`)
        })

        const teardown = (reason: DesktopStreamTeardownTrigger): void => {
            teardownTrigger = teardownTrigger ?? reason
            pump.teardown(reason)
        }
        ws.addEventListener('close', () => teardown('ws-closed'))
        ws.addEventListener('error', () => teardown('ws-closed'))
        socket.on('close', () => teardown('target-closed'))
        socket.on('error', () => teardown('target-closed'))

        const onAbort = (): void => teardown('aborted')
        if (params.signal?.aborted) {
            onAbort()
        } else if (params.signal) {
            params.signal.addEventListener('abort', onAbort, { once: true })
            pump.onTeardown(() => params.signal?.removeEventListener('abort', onAbort))
        }

        // metadata 已送达，开泵（TCP 侧仍在 pause，泵恢复数据通路）
        socket.resume()

        // 5. 流生命周期：任一侧关闭/abort → teardown → settle
        await new Promise<void>((resolve) => {
            pump.onTeardown(() => resolve())
        })
    })()

    return {
        done: done.finally(() => log('desktop stream transport settled')),
        get trigger() {
            return teardownTrigger
        },
    }
}
