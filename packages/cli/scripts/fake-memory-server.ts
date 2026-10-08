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
 * 最小假记忆服务（agent-memory E2E 桩，非生产代码）。
 *
 * 模拟 hindsight server 的最小面：对任意路径/方法回 200 JSON（`/health` 与
 * recall/retain 等端点同形状），把每个请求按行追加到 FAKE_MEMORY_LOG 指定的
 * JSONL 文件。E2E 断言面是「mobi 侧行为」（挂载/env 注入/请求发出）——
 * 不模拟引擎语义（recall/retain 属票 01 云端实测）。
 * 运行：bun packages/cli/scripts/fake-memory-server.ts [port]（默认 3999）
 * 记录：FAKE_MEMORY_LOG=/tmp/e2e-memory-requests.jsonl
 */

import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 3999)
const logPath = process.env.FAKE_MEMORY_LOG ?? ''

interface FakeMemoryRequest {
    at: number
    method: string
    path: string
    /** Bearer token 是否携带（只记布尔，token 明文不落测试日志） */
    hasAuth: boolean
}

const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
        const entry: FakeMemoryRequest = {
            at: Date.now(),
            method: req.method ?? 'GET',
            path: req.url ?? '/',
            hasAuth: Boolean(/^Bearer\s+\S+/.test(req.headers.authorization ?? '')),
        }
        const line = JSON.stringify(entry)
        console.log(`[fake-memory] ${line}`)
        if (logPath) {
            appendFileSync(logPath, `${line}\n`)
        }
        // hook 端 fail-open：任何 200 JSON 都不会让 hook 阻塞会话
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, memories: [] }))
    })
})

server.listen(port, '127.0.0.1', () => {
    console.log(`[fake-memory] listening on 127.0.0.1:${port}${logPath ? ` (log: ${logPath})` : ''}`)
})
