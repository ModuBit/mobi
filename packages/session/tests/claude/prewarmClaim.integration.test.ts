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
 * prewarm/claim 真机集成验证（迭代三票 3.1，SDK 0.3.304 Alpha API）。
 *
 * 环境：真 SDK 调用（真起 claude 进程，单条 30s+）——默认 skip，显式跑：
 *   MOBI_SDK_INTEGRATION=1 bun vitest run tests/claude/prewarmClaim.integration.test.ts
 *
 * 锁定契约（SparePool 票 3.2 的地基，回退语义据此实现）：
 * - prewarm() 无 cwd 时在私有 parking 目录等待（不落会话目录）
 * - claim({prompt, options:{cwd}}) 同步返回 Query（AsyncGenerator 消费链零改动）
 * - claimed resolve 带 sessionId/parkedMs；拒绝（cwd 不存在）reject 带 reason，
 *   prompt 得 not_claimed error result——回退 query() 冷启动
 * - parked 进程内存 ~230–260MB（池=1 的依据）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUN = Boolean(process.env.MOBI_SDK_INTEGRATION)

describe.skipIf(!RUN)('prewarm/claim 集成（SDK 0.3.304）', { timeout: 180_000 }, () => {
    let prewarm: typeof import('@anthropic-ai/claude-agent-sdk').prewarm
    let query: typeof import('@anthropic-ai/claude-agent-sdk').query
    let workDir: string

    beforeAll(async () => {
        ({ prewarm, query } = await import('@anthropic-ai/claude-agent-sdk'))
        workDir = mkdtempSync(join(tmpdir(), 'mobi-prewarm-it-'))
    })

    afterAll(() => {
        if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
    })

    it('prewarm → parked 等待；claim 绑定 cwd 后 Query 正常出消息', async () => {
        const spare = await prewarm({})

        // parked：claimed 未 settle（无 claim 即无 cwd/session）
        let settled = false
        void spare.claimed.then(() => { settled = true }, () => { settled = true })
        await new Promise((r) => setTimeout(r, 300))
        expect(settled).toBe(false)

        // parked 进程内存（官方口径 230–260MB；ps rss 单位 KB）
        const rssKb = Number(execSync(
            `ps -eo rss=,command= | grep "await-claim" | grep -v grep | awk '{s+=$1} END {print s}'`,
        ).toString().trim() || '0')
        expect(rssKb).toBeGreaterThan(100_000) // >100MB： spare 确实在场（宽松下界防抖动）

        const q = spare.claim({
            prompt: '只回复 OK',
            options: { cwd: workDir },
        })
        expect(typeof q[Symbol.asyncIterator]).toBe('function') // Query 消费链零改动

        const claimInfo = await spare.claimed
        expect(claimInfo.sessionId).toBeTruthy()
        expect(claimInfo.parkedMs).toBeGreaterThanOrEqual(0)

        // 消费 Query 直到 result（claim 的 prompt 正常执行）
        const types: string[] = []
        for await (const message of q) {
            types.push((message as { type: string }).type)
            if ((message as { type: string; subtype?: string }).subtype === 'success') break
        }
        expect(types).toContain('system') // init 握手
        expect(types.some((t) => t === 'assistant' || t === 'user')).toBe(true)
    })

    it('claim 到不存在 cwd → claimed reject，回退 query() 冷启动可行', async () => {
        const spare = await prewarm({})
        const q = spare.claim({
            prompt: '只回复 OK',
            options: { cwd: join(workDir, 'no-such-dir') },
        })

        // 拒绝：reason 带 cwd 语义；prompt 得 not_claimed error result
        await expect(spare.claimed).rejects.toThrow()
        let sawNotClaimed = false
        for await (const message of q) {
            const m = message as { type: string; subtype?: string; result?: string; is_error?: boolean }
            if (m.is_error || (m.result ?? '').startsWith('not_claimed')) { sawNotClaimed = true; break }
            if (m.subtype === 'success') break
        }
        expect(sawNotClaimed).toBe(true)

        // 回退路径：同 cwd 冷 query() 正常（spare.close 先释放回调）
        await spare.close()
        const cold = query({ prompt: '只回复 OK', options: { cwd: workDir } })
        let coldOk = false
        for await (const message of cold) {
            const m = message as { subtype?: string; is_error?: boolean }
            if (m.subtype === 'success') { coldOk = !m.is_error; break }
        }
        expect(coldOk).toBe(true)
    })
})
