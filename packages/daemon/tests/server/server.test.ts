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
 * startServer / ServerHandle.stop 生命周期（ticket-16 验收项）。
 *
 * startServer 从 index.ts 抽出后成为可复用组件——daemon 同进程编排依赖
 * 「stop 后端口真正释放」（否则 daemon stop → start 会撞自己残留的监听），
 * 此处做真实起停验证：起 → /health 可达 → stop → 端口可被重新绑定。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer, type ServerHandle } from '../../src/server'

const DATA_DIR = join(tmpdir(), `mobi-test-server-${process.pid}`)

/** 借用即还：拿一个当前空闲的 TCP 端口 */
function pickFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: { data: () => {}, open: () => {} },
        })
        const port = server.port
        server.stop(true)
        resolve(port)
    })
}

describe('startServer / stop 生命周期', () => {
    let handle: ServerHandle
    let port: number
    const savedEnv: Record<string, string | undefined> = {}

    beforeAll(async () => {
        mkdirSync(DATA_DIR, { recursive: true })
        // startServer 经 env 覆盖监听地址，须隔离并事后还原（bun test 单文件单进程）。
        // 宿主端口同样 pickFree：随机主端口 +10000 派生会越界（>65535），显式指定
        for (const key of ['MOBI_HOME', 'MOBI_LISTEN_HOST', 'MOBI_LISTEN_PORT', 'MOBI_HOST_PORT']) {
            savedEnv[key] = process.env[key]
        }
        process.env.MOBI_HOME = DATA_DIR
        port = await pickFreePort()
        process.env.MOBI_HOST_PORT = String(await pickFreePort())
        handle = await startServer({ host: '127.0.0.1', port })
    })

    afterAll(async () => {
        await handle.stop()
        rmSync(DATA_DIR, { recursive: true, force: true })
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    })

    it('opts 覆盖端口生效，/health 可达', async () => {
        expect(handle.port).toBe(port)
        const response = await fetch(`http://127.0.0.1:${port}/health`)
        expect(response.ok).toBe(true)
    })

    it('宿主 listener 生效：hostPort /health 可达、主端口 /cli/* 显式 404（ticket-21）', async () => {
        const hostHealth = await fetch(`http://127.0.0.1:${handle.hostPort}/health`)
        expect(hostHealth.ok).toBe(true)

        // 边界靠拓扑：主端口对宿主路径 404（frp 只转发主端口 → 外网够不到 /cli/*）
        const mainPortCli = await fetch(`http://127.0.0.1:${port}/cli/sessions`)
        expect(mainPortCli.status).toBe(404)
    })

    it('stop → 端口释放（可被重新绑定）、幂等', async () => {
        await handle.stop()
        // 端口可被立即重新绑定 = webServer 真正停了
        const rebind = Bun.listen({
            hostname: '127.0.0.1',
            port,
            socket: { data: () => {}, open: () => {} },
        })
        rebind.stop(true)
        // 幂等：二次 stop 不抛错
        await handle.stop()
    })

    it('stop 后 /health 不再应答', async () => {
        let refused = false
        try {
            await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) })
        } catch {
            refused = true
        }
        expect(refused).toBe(true)
    })
})
