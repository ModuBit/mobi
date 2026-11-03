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
 * 休眠动作流的阻塞反馈契约（session-retention 票 01）：gate 阻塞时只展示逐项原因，
 * 不再提供「仍要退出」强制兜底（close 语义已作废），因此不存在第二个 API 调用。
 */

import { describe, it, expect, vi } from 'vitest'
import type { TFunction } from 'i18next'
import type { QueryClient } from '@tanstack/react-query'
import { dormantSessionWithFeedback } from '@/core/data/sessionDormancy'
import type { DormancyActionDeps } from '@/core/data/sessionDormancy'

/** 模拟 axios 版的 409 blocker 错误（extractBlockers 只看 isAxiosError + response.data.blockers） */
const blockedError = () => ({ isAxiosError: true, response: { status: 409, data: { blockers: ['running'] } } })

function makeDeps(dormant: ReturnType<typeof vi.fn>) {
    const deps = {
        api: { sessions: { dormant } } as unknown as DormancyActionDeps['api'],
        queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
        t: ((key: string) => key) as unknown as TFunction,
        message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } as unknown as DormancyActionDeps['message'],
    }
    return deps
}

describe('dormantSessionWithFeedback', () => {
    it('gate 阻塞时只提示逐项原因，不再触发强制退出', async () => {
        const dormant = vi.fn().mockRejectedValue(blockedError())
        const deps = makeDeps(dormant)
        const onDone = vi.fn()

        await dormantSessionWithFeedback(deps, 'session-1', onDone)

        expect(dormant).toHaveBeenCalledTimes(1)
        expect(deps.message.warning).toHaveBeenCalledWith('session.dormancy.blocked')
        expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('非 blocker 失败给通用失败文案', async () => {
        const dormant = vi.fn().mockRejectedValue(new Error('disconnected'))
        const deps = makeDeps(dormant)

        await dormantSessionWithFeedback(deps, 'session-1', vi.fn())

        expect(deps.message.warning).toHaveBeenCalledWith('session.dormancy.failed')
    })

    it('成功时提示并失效会话视图', async () => {
        const dormant = vi.fn().mockResolvedValue(undefined)
        const deps = makeDeps(dormant)

        await dormantSessionWithFeedback(deps, 'session-1', vi.fn())

        expect(deps.message.success).toHaveBeenCalledWith('common.success')
        expect(deps.queryClient.invalidateQueries).toHaveBeenCalled()
    })
})
