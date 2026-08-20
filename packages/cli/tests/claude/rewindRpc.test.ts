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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRewindHandlers, type RewindSessionView } from '../../src/claude/utils/rewindHandlers'
import { MessageQueue } from '../../src/utils/MessageQueue'
import { REWIND_EXIT_SENTINEL } from '../../src/claude/utils/rewindSentinel'
import type { EnhancedMode, QueryControlRef } from '../../src/claude/types'

vi.mock('../../src/claude/utils/rewindAnchor', () => ({
    findRewindAnchor: vi.fn(),
}))
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { findRewindAnchor } from '../../src/claude/utils/rewindAnchor'

const mockedFindAnchor = vi.mocked(findRewindAnchor)

/** 装配 handler 并返回捕获的处理函数表 */
function setup(opts: {
    session?: Partial<RewindSessionView>
    rewindFiles?: QueryControlRef['current']['rewindFiles']
} = {}) {
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>()
    const rpcManager = {
        registerHandler: (method: string, handler: (params: unknown) => Promise<unknown>) => {
            handlers.set(method, handler)
        },
    }
    const session: RewindSessionView = {
        sessionId: 'native-sess-1',
        running: false,
        pendingRewind: null,
        rewindInFlight: false,
        ...opts.session,
    }
    const messageQueue = new MessageQueue<EnhancedMode>(m => JSON.stringify(m))
    const queryControl: QueryControlRef = { current: null }
    if (opts.rewindFiles) {
        queryControl.current = {
            setPermissionMode: vi.fn(),
            setModel: vi.fn(),
            applyFlagSettings: vi.fn(),
            rewindFiles: opts.rewindFiles,
        }
    }

    registerRewindHandlers({
        rpcManager,
        getRewindSession: () => session,
        messageQueue,
        queryControl,
        workingDirectory: '/work/dir',
    })

    return { handlers, session, messageQueue }
}

/**
 * rewind RPC handler：dry-run 预检、执行闸门、文件回滚先于截断、pendingRewind 状态与哨兵入队。
 * @see packages/cli/src/claude/utils/rewindHandlers.ts
 */
describe('rewind RPC handlers', () => {
    beforeEach(() => {
        mockedFindAnchor.mockReset()
    })

    describe('rewind-dry-run', () => {
        it('锚点不存在 → canRewind false（reason 带 /clear 引导）', async () => {
            mockedFindAnchor.mockResolvedValue(null)
            const { handlers } = setup()

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRewind: boolean; reason?: string }

            expect(result.canRewind).toBe(false)
            expect(result.reason).toContain('/clear')
            expect(mockedFindAnchor).toHaveBeenCalledWith('native-sess-1', '/work/dir', 'u1')
        })

        it('session 未知（未回填）→ canRewind false', async () => {
            const { handlers } = setup({ session: { sessionId: null } })

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRewind: boolean }

            expect(result.canRewind).toBe(false)
            expect(mockedFindAnchor).not.toHaveBeenCalled()
        })

        it('锚点存在 + rewindFiles dryRun canRewind true → 双 true', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const rewindFiles = vi.fn().mockResolvedValue({ canRewind: true })
            const { handlers } = setup({ rewindFiles })

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRewind: boolean; canRestoreFiles: boolean }

            expect(result).toEqual({ canRewind: true, canRestoreFiles: true })
            expect(rewindFiles).toHaveBeenCalledWith('u1', { dryRun: true })
        })

        it('rewindFiles dryRun canRewind false → canRestoreFiles false（动态降级）', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers } = setup({ rewindFiles: vi.fn().mockResolvedValue({ canRewind: false, error: 'checkpoint window exceeded' }) })

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRestoreFiles: boolean }

            expect(result.canRestoreFiles).toBe(false)
        })

        it('query 句柄不可达 → 保守 canRestoreFiles true（执行阶段以实际结果为准）', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers } = setup()

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRestoreFiles: boolean }

            expect(result.canRestoreFiles).toBe(true)
        })

        it('rewindFiles dryRun 抛错 → 保守 canRestoreFiles true', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers } = setup({ rewindFiles: vi.fn().mockRejectedValue(new Error('rpc down')) })

            const result = await handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRestoreFiles: boolean }

            expect(result.canRestoreFiles).toBe(true)
        })

        it('rewind 在途（rewindInFlight / pendingRewind）→ canRewind false（reason 含 in progress）', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const inflight = setup({ session: { rewindInFlight: true } })
            const result1 = await inflight.handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRewind: boolean; reason?: string }
            expect(result1.canRewind).toBe(false)
            expect(result1.reason).toContain('in progress')
            // 不做锚点预检（busy 与锚点无关，省一次 transcript 读取）
            expect(mockedFindAnchor).not.toHaveBeenCalled()

            const pending = setup({ session: { pendingRewind: { nativeId: 'u0', resumeAt: 'a0', filesRestored: false } } })
            const result2 = await pending.handlers.get('rewind-dry-run')!({ nativeId: 'u1' }) as { canRewind: boolean }
            expect(result2.canRewind).toBe(false)
        })
    })

    describe('rewind 执行', () => {
        it('rewind 在途（rewindInFlight / pendingRewind）→ busy 拒绝，不动队列不查锚点', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const inflight = setup({ session: { rewindInFlight: true } })
            const result1 = await inflight.handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean; reason: string }
            expect(result1.accepted).toBe(false)
            expect(result1.reason).toContain('in progress')
            expect(mockedFindAnchor).not.toHaveBeenCalled()

            const pending = setup({ session: { pendingRewind: { nativeId: 'u0', resumeAt: 'a0', filesRestored: false } } })
            const result2 = await pending.handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean }
            expect(result2.accepted).toBe(false)
        })

        it('并发窗口互斥：第一个请求 await 文件回滚期间，第二个请求 busy 拒绝（占位先于任何 await）', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            let releaseRestore: (() => void) | null = null
            const rewindFiles = vi.fn().mockImplementation(() => new Promise(resolve => {
                releaseRestore = () => resolve({ canRewind: true })
            }))
            const { handlers, session } = setup({ rewindFiles })

            // 第一个请求进入文件回滚的 await（未完成，pendingRewind 尚未置位）
            const first = handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: true })
            await vi.waitFor(() => expect(session.rewindInFlight).toBe(true))

            // 第二个请求在此窗口到达：必须被同步占位拦下
            const second = await handlers.get('rewind')!({ nativeId: 'u2', restoreFiles: false }) as { accepted: boolean; reason: string }
            expect(second.accepted).toBe(false)
            expect(second.reason).toContain('in progress')

            // 第一个请求正常完成
            releaseRestore!()
            expect(await first).toEqual({ accepted: true })
            expect(session.pendingRewind).toEqual({ nativeId: 'u1', resumeAt: 'a1', filesRestored: true })
            expect(session.rewindInFlight).toBe(false)
        })

        it('干净失败后释放占位：后续请求可再次发起（finally 兜底，不残留死锁）', async () => {
            // 第一次：锚点复检失败被拒
            mockedFindAnchor.mockResolvedValueOnce(null).mockResolvedValueOnce('a1')
            const { handlers, session } = setup()
            const first = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean }
            expect(first.accepted).toBe(false)
            expect(session.rewindInFlight).toBe(false)

            // 第二次：同样的请求可重新走完整流程并受理
            const second = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean }
            expect(second.accepted).toBe(true)
            expect(session.pendingRewind).toEqual({ nativeId: 'u1', resumeAt: 'a1', filesRestored: false })
        })

        it('队列非空 → 拒绝且不清队列', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers, messageQueue } = setup()
            messageQueue.push('queued', { permissionMode: 'default' }, 'loc-q')

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('queue')
            expect(messageQueue.size()).toBe(1)
            expect(mockedFindAnchor).not.toHaveBeenCalled()
        })

        it('running → 拒绝', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers } = setup({ session: { running: true } })

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('running')
        })

        it('锚点复检不存在 → 拒绝（reason 带 /clear 引导）', async () => {
            mockedFindAnchor.mockResolvedValue(null)
            const { handlers, session } = setup()

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('/clear')
            expect(session.pendingRewind).toBeNull()
        })

        it('restoreFiles 但 query 句柄不可达 → 干净失败（不截断不清队列）', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers, session } = setup()

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: true }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('query handle')
            expect(session.pendingRewind).toBeNull()
        })

        it('restoreFiles 且 rewindFiles canRewind false → 干净失败，文件未回滚', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers, session } = setup({
                rewindFiles: vi.fn().mockResolvedValue({ canRewind: false, error: 'No file checkpoint found' }),
            })

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: true }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('file restore unavailable')
            expect(result.reason).toContain('No file checkpoint found')
            expect(session.pendingRewind).toBeNull()
        })

        it('restoreFiles 且 rewindFiles 抛错 → 干净失败', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers, session } = setup({
                rewindFiles: vi.fn().mockRejectedValue(new Error('boom')),
            })

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: true }) as { accepted: boolean; reason: string }

            expect(result.accepted).toBe(false)
            expect(result.reason).toContain('file restore failed')
            expect(session.pendingRewind).toBeNull()
        })

        it('闸门通过（restoreFiles false）→ accepted：pendingRewind 置位 + 哨兵入队', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const { handlers, session, messageQueue } = setup()

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: false }) as { accepted: boolean }

            expect(result.accepted).toBe(true)
            // pendingRewind 状态（launcher 下轮消费）：文件未回滚
            expect(session.pendingRewind).toEqual({ nativeId: 'u1', resumeAt: 'a1', filesRestored: false })
            // 哨兵以 isolate 入队（清队已在闸门前保证空队列）：下次 collect 单独取出，供 launcher nextMessage 识别退出
            expect(messageQueue.size()).toBe(1)
            const batch = await messageQueue.waitForMessagesAndGetAsString()
            expect(batch?.isolate).toBe(true)
            expect(batch?.message).toBe(REWIND_EXIT_SENTINEL)
        })

        it('闸门通过（restoreFiles true + rewindFiles 成功）→ accepted 且 filesRestored true', async () => {
            mockedFindAnchor.mockResolvedValue('a1')
            const rewindFiles = vi.fn().mockResolvedValue({ canRewind: true, filesChanged: ['a.txt'] })
            const { handlers, session } = setup({ rewindFiles })

            const result = await handlers.get('rewind')!({ nativeId: 'u1', restoreFiles: true }) as { accepted: boolean }

            expect(result.accepted).toBe(true)
            // 文件回滚先于截断（截断前 checkpoint 才有效），结果携带进 pendingRewind 供终态回报
            expect(rewindFiles).toHaveBeenCalledWith('u1')
            expect(session.pendingRewind).toEqual({ nativeId: 'u1', resumeAt: 'a1', filesRestored: true })
        })
    })
})
