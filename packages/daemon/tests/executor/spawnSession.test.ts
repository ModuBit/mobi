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
 * spawn 编排（架构评审候选⑧票②）的假件驱动测试面：此前 352 行编排主体
 * 缩在 startExecutor 闭包里零直接测试（纯函数都抽出去测了，剩下的恰好是
 * 抽不出的编排）。场景 = 定稿清单：dedup / 目录分支与 errno 文案树 /
 * worktree 三清理时机（child 存活守卫）/ webhook 超时与及时到达。
 * 追踪表用真 module（webhook 由测试手动 applyWebhook 驱动）。
 */

import { describe, it, expect, vi } from 'vitest'
import { spawnSession, describeMkdirError, buildWebhookFailureMessage } from '@/executor/spawnSession'
import { SessionTrackingTable } from '@/executor/sessionTrackingTable'
import type { SpawnSessionDeps, SpawnedCliProcess } from '@/executor/spawnSession'
import type { SpawnSessionOptions } from '@mobi/shared/hostProtocol'

/** 可控假进程：pid 可塑、exit/error 可手动触发（on 必须单实现分发——
 *  class 里两个同名 on 声明会后者覆盖前者，exit 监听会静默丢失） */
class FakeProcess implements SpawnedCliProcess {
    pid?: number | undefined
    private exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
    private errorListeners: Array<(error: Error) => void> = []
    stderrData: Buffer | null = null
    get stderr() {
        const self = this
        return {
            on(_event: 'data', listener: (chunk: Buffer) => void) {
                if (self.stderrData) listener(self.stderrData)
            },
        }
    }
    once(_event: 'error', listener: (e: Error) => void) { this.errorListeners.push(listener) }
    removeListener(_event: 'error', _listener: (e: Error) => void) { /* 测试无需精确移除 */ }
    on(event: 'exit' | 'error', listener: (...args: never[]) => void): void {
        if (event === 'exit') this.exitListeners.push(listener as never)
        else this.errorListeners.push(listener as never)
    }
    emitExit(code: number | null, signal: NodeJS.Signals | null = null) { for (const l of this.exitListeners) l(code, signal) }
    emitError(err: Error) { for (const l of this.errorListeners) l(err) }
}

function makeDeps(overrides: Partial<SpawnSessionDeps> = {}) {
    const table = new SessionTrackingTable()
    const spawnFn = vi.fn(() => new FakeProcess())
    const deps: SpawnSessionDeps = {
        trackingTable: table,
        hostPort: 12222,
        reportOutcome: vi.fn(),
        fs: {
            access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
        spawn: spawnFn,
        createWorktree: vi.fn().mockResolvedValue({ ok: true, info: { worktreePath: '/wt', basePath: '/repo', branch: 'b', name: 'wt', createdAt: 1 } as never }),
        removeWorktree: vi.fn().mockResolvedValue({ ok: true }),
        isProcessAlive: vi.fn().mockReturnValue(false),
        ...overrides,
    }
    return { deps, table, spawnFn }
}

const simpleOptions = { directory: '/work', sessionType: 'simple' } as unknown as SpawnSessionOptions

describe('spawnSession dedup 与目录分支', () => {
    it('唤醒去重命中 → 幂等返回 already-running，不 spawn', async () => {
        const { deps, spawnFn } = makeDeps()
        deps.trackingTable.registerDaemon({ startedBy: 'daemon', pid: 1, resumeSessionId: 'resume-1' } as never)

        const result = await spawnSession({ ...simpleOptions, resumeSessionId: 'resume-1' } as SpawnSessionOptions, deps)

        expect(result.type).toBe('already-running')
        expect(spawnFn).not.toHaveBeenCalled()
    })

    it('目录缺省 + 未批准 → requestToApproveDirectoryCreation（不 mkdir）', async () => {
        const { deps } = makeDeps()
        const result = await spawnSession({ ...simpleOptions, approvedNewDirectoryCreation: false } as SpawnSessionOptions, deps)
        expect(result).toEqual({ type: 'requestToApproveDirectoryCreation', directory: '/work' })
        expect(deps.fs.mkdir).not.toHaveBeenCalled()
    })

    it('mkdir EACCES → errno 文案树', async () => {
        const { deps } = makeDeps()
        ;(deps.fs.mkdir as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
        const result = await spawnSession(simpleOptions, deps)
        expect(result.type).toBe('error')
        expect((result as { errorMessage: string }).errorMessage).toBe(describeMkdirError('/work', Object.assign(new Error('denied'), { code: 'EACCES' })))
        expect((result as { errorMessage: string }).errorMessage).toContain('Permission denied')
    })

    it('worktree 会话且基目录缺失 → error 透传', async () => {
        const { deps } = makeDeps()
        const result = await spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        expect(result.type).toBe('error')
        expect((result as { errorMessage: string }).errorMessage).toContain('Worktree sessions require an existing Git repository')
    })

    it('worktree 创建失败 → error 原样透传', async () => {
        const { deps } = makeDeps({
            fs: { access: vi.fn().mockResolvedValue(undefined), mkdir: vi.fn() },
            createWorktree: vi.fn().mockResolvedValue({ ok: false, error: 'git blew up' }),
        })
        const result = await spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        expect(result).toEqual({ type: 'error', errorMessage: 'git blew up' })
    })
})

describe('spawnSession worktree 清理时机', () => {
    function worktreeDeps(spawnImpl: SpawnSessionDeps['spawn']) {
        return makeDeps({
            fs: { access: vi.fn().mockResolvedValue(undefined), mkdir: vi.fn() },
            spawn: spawnImpl,
        })
    }

    it('no-pid（spawn 即失败）→ worktree 清理被调', async () => {
        const dead = new FakeProcess() // pid 未赋值 = no pid
        const { deps } = worktreeDeps(() => dead)
        const result = await spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        expect(result.type).toBe('error')
        expect(deps.removeWorktree).toHaveBeenCalledTimes(1)
    })

    it('webhook 等待失败且 child 已死（isAlive=false）→ 清理被调', async () => {
        const child = new FakeProcess()
        child.pid = 42
        const { deps, table } = worktreeDeps(() => child)
        ;(deps.isProcessAlive as ReturnType<typeof vi.fn>).mockReturnValue(false)

        // exit 先于 webhook → failAwaiter 立即 resolve error
        const pending = spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        await vi.waitFor(() => expect(table.get(42)).toBeDefined())
        // 等编排走到 waitForWebhook（awaiter 已挂）再触发 exit，否则 exit 早于注册被静默吞掉
        await new Promise((r) => setTimeout(r, 10))
        child.emitExit(1)
        const result = await pending

        expect(result.type).toBe('error')
        expect(deps.removeWorktree).toHaveBeenCalledTimes(1)
    })

    it('webhook 等待失败但 child 存活（isAlive=true）→ 跳过清理', async () => {
        const child = new FakeProcess()
        child.pid = 43
        const { deps, table } = worktreeDeps(() => child)
        ;(deps.isProcessAlive as ReturnType<typeof vi.fn>).mockReturnValue(true)

        const pending = spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        await vi.waitFor(() => expect(table.get(43)).toBeDefined())
        await new Promise((r) => setTimeout(r, 10))
        child.emitExit(1)
        const result = await pending

        expect(result.type).toBe('error')
        expect(deps.removeWorktree).not.toHaveBeenCalled()
    })

    it('webhook 及时到达 → success 且不清理 worktree', async () => {
        const child = new FakeProcess()
        child.pid = 44
        const { deps, table } = worktreeDeps(() => child)

        const pending = spawnSession({ directory: '/repo', sessionType: 'worktree' } as unknown as SpawnSessionOptions, deps)
        await vi.waitFor(() => expect(table.get(44)).toBeDefined())
        table.applyWebhook('sess-ok', { hostPid: 44 } as never)
        const result = await pending

        expect(result).toEqual({ type: 'success', sessionId: 'sess-ok' })
        expect(deps.removeWorktree).not.toHaveBeenCalled()
        expect(deps.reportOutcome).toHaveBeenCalledWith({ type: 'success' })
    })
})

describe('spawnSession webhook 等待与上报', () => {
    it('webhook 超时 → timeout 文案 + error outcome 上报（含 pid）', async () => {
        vi.useFakeTimers()
        try {
            const child = new FakeProcess()
            child.pid = 50
            const { deps } = makeDeps({ spawn: () => child })

            const pending = spawnSession(simpleOptions, deps)
            // 排干 mock resolved 微任务链，让编排走到 waitForWebhook（15s timer 已挂）
            for (let i = 0; i < 20; i++) await Promise.resolve()
            vi.advanceTimersByTime(15_001)
            const result = await pending

            expect(result.type).toBe('error')
            expect((result as { errorMessage: string }).errorMessage).toContain('Session webhook timeout for PID 50')
            expect(deps.reportOutcome).toHaveBeenCalledWith(expect.objectContaining({
                type: 'error',
                details: expect.objectContaining({ pid: 50 }),
            }))
        } finally {
            vi.useRealTimers()
        }
    })

    it('exit-before-webhook → 文案含 exit code 与 stderr tail', async () => {
        const child = new FakeProcess()
        child.pid = 51
        child.stderrData = Buffer.from('boom\nstack trace')
        const { deps, table } = makeDeps({ spawn: () => child })

        const pending = spawnSession(simpleOptions, deps)
        await vi.waitFor(() => expect(table.get(51)).toBeDefined())
        await new Promise((r) => setTimeout(r, 10))
        child.emitExit(3)
        const result = await pending

        expect((result as { errorMessage: string }).errorMessage).toBe(
            buildWebhookFailureMessage('exit-before-webhook', 51, { exitCode: 3, exitSignal: null }, 'boom\nstack trace'))
    })
})

describe('错误文案树纯函数', () => {
    it('四个 errno 各给行动建议、未知错误透传系统 message', () => {
        expect(describeMkdirError('/d', Object.assign(new Error('x'), { code: 'EACCES' }))).toContain('Permission denied')
        expect(describeMkdirError('/d', Object.assign(new Error('x'), { code: 'ENOTDIR' }))).toContain('A file already exists')
        expect(describeMkdirError('/d', Object.assign(new Error('x'), { code: 'ENOSPC' }))).toContain('No space left')
        expect(describeMkdirError('/d', Object.assign(new Error('x'), { code: 'EROFS' }))).toContain('read-only')
        expect(describeMkdirError('/d', Object.assign(new Error('weird errno'), { code: 'EXXX' }))).toContain('System error: weird errno')
    })

    it('stderr tail 超 800 字符取尾部并压空白', () => {
        const long = 'a'.repeat(900)
        const msg = buildWebhookFailureMessage('timeout', 1, { exitCode: null, exitSignal: null }, long)
        expect(msg).toContain(`stderr: ${'a'.repeat(800)}`)
    })
})
