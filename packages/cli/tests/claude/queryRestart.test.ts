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

import { describe, expect, it, vi } from 'vitest'

import {
    QueryRestartController,
    RESTART_EXIT_SENTINEL,
    type QueryRestartRequest,
} from '../../src/claude/utils/queryRestart'
import type { EnhancedMode } from '../../src/claude/types'
import { MessageQueue } from '../../src/utils/MessageQueue'

const mode: EnhancedMode = { permissionMode: 'default' }

function setup() {
    const discarded: string[][] = []
    const queue = new MessageQueue<EnhancedMode>(value => JSON.stringify(value))
    queue.setOnBatchConsumed(ids => discarded.push(ids))
    const restart = new QueryRestartController(queue)
    return { discarded, queue, restart }
}

describe('QueryRestartController', () => {
    it('同步提交：先公开 pending，再清排队并放入唯一退出哨兵', async () => {
        const { discarded, queue, restart } = setup()
        queue.push('queued message', mode, 'local-1')
        let stateSeenBySentinel: QueryRestartRequest | null = null
        queue.setOnMessage((message) => {
            if (message === RESTART_EXIT_SENTINEL) stateSeenBySentinel = restart.current()
        })
        const onAccepted = vi.fn()

        expect(restart.trySchedule({ kind: 'outputStyle' }, onAccepted)).toBe(true)

        expect(onAccepted).toHaveBeenCalledOnce()
        expect(stateSeenBySentinel).toEqual({ kind: 'outputStyle' })
        expect(discarded).toEqual([['local-1']])
        const batch = await queue.waitForMessagesAndGetAsString()
        expect(batch).toMatchObject({ message: RESTART_EXIT_SENTINEL, isolate: true })
    })

    it('已有 pending 时拒绝第二次提交，且不执行其受理副作用', () => {
        const { restart } = setup()
        expect(restart.trySchedule({ kind: 'outputStyle' })).toBe(true)
        const onAccepted = vi.fn()

        expect(restart.trySchedule({ kind: 'outputStyle' }, onAccepted)).toBe(false)

        expect(onAccepted).not.toHaveBeenCalled()
        expect(restart.current()).toEqual({ kind: 'outputStyle' })
    })

    it('异步准备：进入 await 前即占用通道，完成后原子提交请求', async () => {
        const { restart } = setup()
        let finishPreparation!: () => void
        const preparationGate = new Promise<void>(resolve => { finishPreparation = resolve })
        const request: QueryRestartRequest = {
            kind: 'rewind', nativeId: 'user-1', resumeAt: 'assistant-0', filesRestored: false,
        }

        const first = restart.tryPrepare(async () => {
            await preparationGate
            return { ready: true, request }
        })
        expect(restart.busy).toBe(true)

        expect(restart.trySchedule({ kind: 'outputStyle' })).toBe(false)
        await expect(restart.tryPrepare(async () => ({ ready: true, request }))).resolves.toBeNull()

        finishPreparation()
        await expect(first).resolves.toEqual({ accepted: true })
        expect(restart.current()).toBe(request)
    })

    it('异步准备被业务拒绝或抛错后释放占位，不留下死锁', async () => {
        const { restart } = setup()

        await expect(restart.tryPrepare(async () => ({ ready: false, reason: 'not ready' })))
            .resolves.toEqual({ accepted: false, reason: 'not ready' })
        expect(restart.busy).toBe(false)

        await expect(restart.tryPrepare(async () => { throw new Error('prepare failed') }))
            .rejects.toThrow('prepare failed')
        expect(restart.busy).toBe(false)
        expect(restart.trySchedule({ kind: 'outputStyle' })).toBe(true)
    })

    it('消费退出哨兵：outputStyle 立即清位，rewind 保留到截断完成', () => {
        const output = setup()
        const outputRequest: QueryRestartRequest = { kind: 'outputStyle' }
        output.restart.trySchedule(outputRequest)

        expect(output.restart.consumeExitSignal()).toBe(outputRequest)
        expect(output.restart.current()).toBeNull()
        expect(output.restart.consumeExitSignal()).toBeNull()

        const rewind = setup()
        const rewindRequest: QueryRestartRequest = {
            kind: 'rewind', nativeId: 'user-1', resumeAt: 'assistant-0', filesRestored: true,
        }
        rewind.restart.trySchedule(rewindRequest)

        expect(rewind.restart.consumeExitSignal()).toBe(rewindRequest)
        expect(rewind.restart.current()).toBe(rewindRequest)
    })

    it('完成请求按对象身份清位，旧轮次不能误清后来请求', () => {
        const { restart } = setup()
        const request: QueryRestartRequest = {
            kind: 'rewind', nativeId: 'user-1', resumeAt: 'assistant-0', filesRestored: false,
        }
        restart.trySchedule(request)

        expect(restart.complete({ ...request })).toBe(false)
        expect(restart.current()).toBe(request)
        expect(restart.complete(request)).toBe(true)
        expect(restart.current()).toBeNull()
        expect(restart.busy).toBe(false)
    })
})
