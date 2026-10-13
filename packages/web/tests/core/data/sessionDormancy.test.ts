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
 * 休眠动作流里「仍要退出」确认弹窗的层号契约：调用方给了层号取值函数就必须落到 confirm 上。
 *
 * 真机来源（2026-10-13）：移动端休眠入口在操作菜单 BottomSheet 内，449/blocker 分支弹出的
 * antd `modal.confirm` 默认 z 1000 < sheet 的 1080+ → 弹窗被整层盖住，按钮点不到、await 永不
 * 落定，菜单又被 pending 态拦着关不掉（卡死）。
 */

import { describe, it, expect, vi } from 'vitest'
import type { TFunction } from 'i18next'
import type { QueryClient } from '@tanstack/react-query'
import type { ModalFuncProps } from 'antd'
import { dormantSessionWithFeedback } from '@/core/data/sessionDormancy'
import type { DormancyActionDeps } from '@/core/data/sessionDormancy'

/** 模拟 axios 版的 409 blocker 错误（extractBlockers 只看 isAxiosError + response.data.blockers） */
const blockedError = () => ({ isAxiosError: true, response: { status: 409, data: { blockers: ['running'] } } })

/** 最小 deps：休眠必定被 gate 阻塞，confirm 一弹就取消（走「用户不强制退出」分支） */
function makeDeps(overrides: Partial<DormancyActionDeps> = {}) {
    const confirm = vi.fn<(props: ModalFuncProps) => void>((props) => {
        props.onCancel?.({} as never)
    })
    const deps = {
        api: { sessions: { dormant: vi.fn().mockRejectedValue(blockedError()) } } as unknown as DormancyActionDeps['api'],
        queryClient: { invalidateQueries: vi.fn() } as unknown as QueryClient,
        t: ((key: string) => key) as unknown as TFunction,
        modal: { confirm } as unknown as DormancyActionDeps['modal'],
        message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } as unknown as DormancyActionDeps['message'],
        ...overrides,
    }
    return { deps, confirm }
}

describe('dormantSessionWithFeedback', () => {
    it('gate 阻塞时弹确认，并把调用方给的层号落到 confirm 上', async () => {
        const { deps, confirm } = makeDeps({ confirmZIndex: () => 1084 })
        const onDone = vi.fn()

        await dormantSessionWithFeedback(deps, 'session-1', onDone)

        expect(confirm).toHaveBeenCalledTimes(1)
        expect(confirm.mock.calls[0][0].zIndex).toBe(1084)
        expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('未给层号取值函数时不写 zIndex（PC 侧无叠层，交回 antd 默认值）', async () => {
        const { deps, confirm } = makeDeps()

        await dormantSessionWithFeedback(deps, 'session-1', vi.fn())

        expect(confirm.mock.calls[0][0].zIndex).toBeUndefined()
    })
})
