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

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * stdio EPIPE 孤儿管道防护测试。
 *
 * 生产事故（2026-08-27）：supervisor 换血杀掉旧 runner 后，其 spawn 的会话 CLI 的
 * stdout/stderr pipe 读端死亡（runner 曾挂着 data 监听收集调试尾巴）。CLI 进程本身
 * 因 detached:true 幸存且照常工作，但 Bun 默认把 process warning 同步写入 stderr，
 * 对死管道写入抛出的 EPIPE 无人处理 → 未捕获异常 → 整个进程暴毙。
 *
 * 本测试用真实子进程复现该场景：spawn 子进程后立刻销毁读端，子进程内先安装防护、
 * 再 emitWarning，断言进程存活走完生命周期（marker 落盘）。无防护时进程会在
 * emitWarning 同步打印阶段静默死亡、marker 缺失。
 */

describe('stdioEpipeGuard', () => {
    it('stderr 管道读端死亡后 emitWarning 不再杀死进程', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-epipe-guard-'))
        const marker = join(dir, 'marker.log')
        const guardSource = resolve(fileURLToPath(new URL('../../src/utils/stdioEpipeGuard.ts', import.meta.url)))

        const childScript = `
            import { appendFileSync } from 'node:fs'
            import { installStdioEpipeGuard } from ${JSON.stringify(guardSource)}
            installStdioEpipeGuard()
            appendFileSync(${JSON.stringify(marker)}, 'start\\n')
            await new Promise(r => setTimeout(r, 200))
            process.emitWarning('repro-warning')
            appendFileSync(${JSON.stringify(marker)}, 'emitted\\n')
            await new Promise(r => setTimeout(r, 800))
            appendFileSync(${JSON.stringify(marker)}, 'survived\\n')
            process.exit(0)
        `

        // 读端立即销毁：等价于旧 runner 死亡后孤儿 CLI 的 stderr 状态
        const child = spawn(process.execPath, ['-e', childScript], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout?.destroy()
        child.stderr?.destroy()

        const exitCode: number | null = await new Promise((resolveExit) => {
            child.on('exit', (code) => resolveExit(code))
        })

        const markerContent = await readFile(marker, 'utf-8')
        await rm(dir, { recursive: true, force: true })

        // 无防护时：'emitted' 之后进程即被 EPIPE 掀翻，'survived' 不会出现
        expect(markerContent).toContain('start')
        expect(markerContent).toContain('emitted')
        expect(markerContent).toContain('survived')
        expect(exitCode).toBe(0)
    })
})
