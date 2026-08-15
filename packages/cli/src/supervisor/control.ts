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
 * Supervisor 控制通道：Unix socket + 换行分隔 JSON 行协议。
 *
 * CLI 命令（service/hub/runner）是客户端，supervisor 常驻进程是服务端。
 * 协议：一行请求 `{id, cmd, ...}` → 一行响应 `{id, ok, data | error}`。
 */

import { connect, createServer, type Socket } from 'node:net'
import { spawnMobiCli } from '@/utils/spawnMobiCli'
import { configuration } from '@/configuration'

export type ServiceScope = 'hub' | 'runner' | 'both'

export type ControlRequest =
    | { cmd: 'start'; scope: ServiceScope; host?: string; port?: number }
    | { cmd: 'stop'; scope: ServiceScope }
    | { cmd: 'restart'; scope: ServiceScope; host?: string; port?: number }
    | { cmd: 'status' }
    | { cmd: 'shutdown' }

export interface ControlResponse {
    id: number
    ok: boolean
    data?: unknown
    error?: string
}

export type ControlHandler = (request: ControlRequest) => Promise<unknown>

export interface ControlServer {
    /** 关闭监听并断开所有连接 */
    stop: () => Promise<void>
}

export async function startControlServer(
    socketPath: string,
    handler: ControlHandler,
): Promise<ControlServer> {
    // 自行跟踪已建立的连接：
    // 当前 Node 类型下 server.connections 是 number | null（不可迭代）、closeAllConnections 不存在，
    // 故维护连接集合以便 stop 时主动断开
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
        sockets.add(socket)
        socket.once('close', () => sockets.delete(socket))
        handleConnection(socket, handler)
    })

    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error)
        server.once('error', onError)
        server.listen(socketPath, () => {
            server.off('error', onError)
            resolve()
        })
    })

    return {
        stop: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve())
                // 断开所有已建立的连接，让 close 立即完成
                for (const socket of sockets) socket.destroy()
            }),
    }
}

function handleConnection(socket: Socket, handler: ControlHandler): void {
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            if (line.trim()) void handleLine(socket, line, handler)
        }
    })
    socket.on('error', () => socket.destroy())
}

async function handleLine(socket: Socket, line: string, handler: ControlHandler): Promise<void> {
    let response: ControlResponse
    let id = -1
    try {
        const parsed = JSON.parse(line) as ControlRequest & { id?: number }
        id = typeof parsed.id === 'number' ? parsed.id : -1
        if (id < 0 || typeof parsed.cmd !== 'string') {
            throw new Error('malformed request: missing id or cmd')
        }
        const { id: _drop, ...request } = parsed
        try {
            response = { id, ok: true, data: await handler(request as ControlRequest) }
        } catch (error) {
            response = { id, ok: false, error: errorMessage(error) }
        }
    } catch (error) {
        response = { id, ok: false, error: errorMessage(error) }
    }
    socket.write(JSON.stringify(response) + '\n')
}

let clientSequence = 0

/** 发送一条控制指令并等待响应。连接失败/超时/服务端报错均 reject。 */
export function sendControlCommand(
    socketPath: string,
    command: ControlRequest,
    timeoutMs: number = 10_000,
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const socket = connect(socketPath)
        const id = ++clientSequence
        let buffer = ''

        const timeout = setTimeout(() => {
            socket.destroy()
            reject(new Error(`Control command timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        socket.on('connect', () => {
            socket.write(JSON.stringify({ id, ...command }) + '\n')
        })

        socket.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8')
            const newlineIndex = buffer.indexOf('\n')
            if (newlineIndex < 0) return
            const line = buffer.slice(0, newlineIndex)
            clearTimeout(timeout)
            socket.destroy()
            try {
                const response = JSON.parse(line) as ControlResponse
                if (!response.ok) {
                    reject(new Error(response.error ?? 'unknown control error'))
                } else {
                    resolve(response.data)
                }
            } catch (error) {
                reject(error)
            }
        })

        socket.on('error', (error) => {
            clearTimeout(timeout)
            reject(error)
        })
    })
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * 确保 supervisor 存活：探活失败则 detached spawn 一个并轮询其 socket 就绪。
 * A 路径（mobi service start 等 CLI 命令）的入口都先调用它。
 */
export async function ensureSupervisorRunning(options: { readyTimeoutMs?: number } = {}): Promise<void> {
    const readyTimeoutMs = options.readyTimeoutMs ?? 15_000

    try {
        // socket 探活：能应答 status 即已在运行
        await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'status' }, 2_000)
        return
    } catch {
        // 尚未运行，spawn
    }

    const child = spawnMobiCli(['service', 'supervise', '--sync'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
    })
    child.unref()

    const deadline = Date.now() + readyTimeoutMs
    while (Date.now() < deadline) {
        try {
            await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'status' }, 1_000)
            return
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 200))
        }
    }
    throw new Error(`Supervisor failed to become ready within ${readyTimeoutMs}ms`)
}
