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
 * loopbackControlPost 端口字段读旧写新（remove-machine 502）：
 * state.controlPort 为新名；存量旧名 runnerHttpPort 兜底可路由。
 * 用本机 http server 实证 fetch 端口（非 mock 读取路径，锁行为不锁实现）。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'

let home: string
let server: Server
let port: number
let seenPath: string | null

beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'mobi-loopback-control-'))
    process.env.MOBI_HOME = home
    vi.resetModules()
    seenPath = null
    server = createServer((req, res) => {
        seenPath = req.url ?? null
        res.setHeader('Content-Type', 'application/json')
        res.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
})

afterEach(async () => {
    delete process.env.MOBI_HOME
    rmSync(home, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
})

function writeState(fields: Record<string, unknown>): void {
    // pid 恒写本进程（探活必须通过），端口字段按用例给新名/旧名
    writeFileSync(join(home, 'daemon.state.json'), JSON.stringify({ pid: process.pid, hostPort: 12222, ...fields }))
}

describe('loopbackControlPost 端口读旧写新（502）', () => {
    it('新名 controlPort 可路由', async () => {
        writeState({ httpPort: 2222, controlPort: port })
        const { loopbackControlPost } = await import('@/utils/loopbackControlPost')

        const result = await loopbackControlPost('/ping')

        expect(result).toEqual({})
        expect(seenPath).toBe('/ping')
    })

    it('存量旧名 runnerHttpPort 兜底可路由（升级窗口兼容）', async () => {
        writeState({ hubPort: 2222, runnerHttpPort: port })
        const { loopbackControlPost } = await import('@/utils/loopbackControlPost')

        const result = await loopbackControlPost('/ping')

        expect(result).toEqual({})
        expect(seenPath).toBe('/ping')
    })

    it('两名字段都缺失 → 返回 error 不抛', async () => {
        writeState({ httpPort: 2222 })
        const { loopbackControlPost } = await import('@/utils/loopbackControlPost')

        const result = await loopbackControlPost('/ping')

        expect((result as { error?: string }).error).toBeTruthy()
    })
})
