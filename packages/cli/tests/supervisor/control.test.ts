/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except compliance with the License.
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startControlServer, sendControlCommand } from '@/supervisor/control'

const SOCKET_PATH = join(tmpdir(), 'mobi-test-supervisor.sock')

describe('supervisor IPC 控制通道', () => {
    let stopServer: (() => Promise<void>) | null = null

    beforeEach(() => {
        if (existsSync(SOCKET_PATH)) rmSync(SOCKET_PATH)
    })

    afterEach(async () => {
        await stopServer?.()
        stopServer = null
    })

    it('请求/响应往返：handler 返回值原样送达客户端', async () => {
        stopServer = (await startControlServer(SOCKET_PATH, async (req) => {
            if (req.cmd === 'status') return { hub: 'running' }
            throw new Error(`unknown cmd: ${req.cmd}`)
        })).stop

        const data = await sendControlCommand(SOCKET_PATH, { cmd: 'status' })
        expect(data).toEqual({ hub: 'running' })
    })

    it('handler 抛错 → 客户端 reject 且错误信息保留', async () => {
        stopServer = (await startControlServer(SOCKET_PATH, async () => {
            throw new Error('hub port occupied')
        })).stop

        await expect(sendControlCommand(SOCKET_PATH, { cmd: 'start', scope: 'hub' }))
            .rejects.toThrow('hub port occupied')
    })

    it('连接不存在的 socket → reject', async () => {
        await expect(sendControlCommand(SOCKET_PATH, { cmd: 'status' }, 500))
            .rejects.toThrow()
    })

    it('客户端超时 → reject（handler 挂起不返回）', async () => {
        stopServer = (await startControlServer(SOCKET_PATH, () => new Promise(() => { /* 永不返回 */ }))).stop

        await expect(sendControlCommand(SOCKET_PATH, { cmd: 'status' }, 300))
            .rejects.toThrow('timed out')
    }, 5_000)
})
