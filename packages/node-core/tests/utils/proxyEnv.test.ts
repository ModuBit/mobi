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

import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ensureLoopbackBypassesProxy } from '@/utils/proxyEnv'

const PROXY_ENV_KEYS = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'no_proxy', 'NO_PROXY'] as const

/** 测试进程可能本身带代理环境变量，先清场并在结束后恢复 */
const savedEnv = new Map<string, string | undefined>()

function setProxyEnv(vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
        if (!savedEnv.has(key)) savedEnv.set(key, process.env[key])
        process.env[key] = value
    }
}

afterEach(() => {
    for (const key of PROXY_ENV_KEYS) {
        const saved = savedEnv.get(key)
        if (saved === undefined) delete process.env[key]
        else process.env[key] = saved
        savedEnv.delete(key)
    }
})

/** 起一个「假代理」：记录收到的请求并一律回 502（模拟本地代理不回源 loopback） */
async function startFakeProxy(): Promise<{ server: Server; port: number; hits: () => number }> {
    let hitCount = 0
    const server = createServer((_req, res) => {
        hitCount += 1
        res.writeHead(502)
        res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, port: (server.address() as AddressInfo).port, hits: () => hitCount }
}

/** 起一个真实目标服务：/health 返回 200 */
async function startTarget(): Promise<{ server: Server; url: string }> {
    const server = createServer((_req, res) => {
        res.writeHead(200)
        res.end('{"status":"ok"}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return { server, url: `http://127.0.0.1:${port}/health` }
}

describe('ensureLoopbackBypassesProxy', () => {
    it('带 http_proxy 时 loopback fetch 不经过代理（生产 bug 复现：健康门被代理劫持回 502）', async () => {
        // 代理劫持是 Bun fetch 的行为（vitest worker 跑在 Node/undici 下不吃代理
        // env），故在 bun 子进程里复现：子进程启动即带 http_proxy，先证基线 502，
        // 再归一化后证直连 200
        const proxy = await startFakeProxy()
        const target = await startTarget()
        try {
            const proxyEnvKey = `http://127.0.0.1:${proxy.port}`
            const script = `
                const mod = await import(${JSON.stringify(fileURLToPath(new URL('../../src/utils/proxyEnv.ts', import.meta.url)))})
                const baseline = await fetch(${JSON.stringify(target.url)}, { signal: AbortSignal.timeout(3000) })
                if (baseline.status !== 502) {
                    console.error('基线应为 502（被代理劫持），实际 ' + baseline.status)
                    process.exit(1)
                }
                mod.ensureLoopbackBypassesProxy()
                const after = await fetch(${JSON.stringify(target.url)}, { signal: AbortSignal.timeout(3000) })
                if (after.status !== 200) {
                    console.error('归一化后应为 200（直连目标），实际 ' + after.status)
                    process.exit(1)
                }
                console.log('OK')
            `
            // 异步 spawn（同步版会阻塞 worker 事件循环，假代理无法应答子进程请求）
            const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
                const child = spawn('bun', ['-e', script], {
                    env: {
                        ...process.env,
                        http_proxy: proxyEnvKey,
                        https_proxy: proxyEnvKey,
                        no_proxy: '',
                        NO_PROXY: '',
                    },
                })
                let stdout = ''
                let stderr = ''
                child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
                child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
                child.on('close', (code) => resolve({ status: code, stdout, stderr }))
            })
            expect(result.stderr).toBe('')
            expect(result.stdout).toContain('OK')
            expect(result.status).toBe(0)
            // 基线确实经过了假代理（复现成立），归一化后不再新增
            expect(proxy.hits()).toBe(1)
        } finally {
            proxy.server.close()
            target.server.close()
        }
    })

    it('归一化同时写入大小写两个变量并保留既有条目，幂等', () => {
        setProxyEnv({ no_proxy: 'internal.example.com', NO_PROXY: '.corp.example.com' })

        ensureLoopbackBypassesProxy()

        const lowercase = process.env.no_proxy!.split(',')
        const uppercase = process.env.NO_PROXY!.split(',')
        for (const entries of [lowercase, uppercase]) {
            expect(entries).toContain('localhost')
            expect(entries).toContain('127.0.0.1')
            expect(entries).toContain('::1')
        }
        expect(lowercase).toContain('internal.example.com')
        expect(uppercase).toContain('.corp.example.com')

        ensureLoopbackBypassesProxy()
        expect(process.env.no_proxy!.split(',').filter((e) => e === 'localhost')).toHaveLength(1)
    })

    it('代理变量未设置时也写入 no_proxy（防后续运行时注入）', () => {
        ensureLoopbackBypassesProxy()
        expect(process.env.no_proxy).toContain('127.0.0.1')
        expect(process.env.NO_PROXY).toContain('localhost')
    })
})
