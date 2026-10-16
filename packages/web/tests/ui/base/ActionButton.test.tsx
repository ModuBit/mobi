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
 * uiarc action-button 自管件的行为契约：点击进入 pending（aria-busy/aria-disabled 保键盘
 * 焦点）、动作期间吞重复点击、resolve 后展示成功态并按 resetAfterMs 复位、reject 回 idle
 * 且 onActionError 收到错误、disabled 拦截。默认态文案走 i18n key。文字 morph、箭头/勾选
 * 动效与宽度 spring 是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ActionButton } from '@/ui/base/interactive/action-button/ActionButton'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

afterEach(cleanup)

describe('uiarc ActionButton 行为契约', () => {
    it('点击进入 pending：aria-busy + aria-disabled（保焦点），状态文案播报 i18n key，重复点击不重复触发', async () => {
        let resolveAction!: () => void
        const onAction = vi.fn(() => new Promise<void>((resolve) => { resolveAction = resolve }))
        render(<ActionButton label="保存" onAction={onAction} />)

        const btn = screen.getByRole('button', { name: '保存' })
        fireEvent.click(btn)

        expect(btn).toHaveAttribute('aria-busy', 'true')
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        expect(btn.dataset.state).toBe('pending')
        expect(screen.getByRole('status')).toHaveTextContent('uiarc.actionButton.saving')

        fireEvent.click(btn)
        expect(onAction).toHaveBeenCalledTimes(1)

        resolveAction()
        await waitFor(() => expect(btn.dataset.state).not.toBe('pending'))
    })

    it('resolve 后展示成功态（显式 successLabel 优先），resetAfterMs 后复位 idle', async () => {
        const onAction = vi.fn().mockResolvedValue(undefined)
        // 窗口须长于 MorphText 装配：20ms 会与成功文本动画赛跑（全量负载下必输）
        render(<ActionButton label="保存" successLabel="已保存" onAction={onAction} resetAfterMs={300} />)

        const btn = screen.getByRole('button', { name: '保存' })
        fireEvent.click(btn)

        await waitFor(() => expect(btn.dataset.state).toBe('success'))
        // 成功文案经 MorphText 动画装配，与 state 翻转不同帧——等文本出现而非同步断言
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'))

        await waitFor(() => expect(btn.dataset.state).toBe('idle'))
        expect(screen.queryByRole('status')).not.toHaveTextContent('已保存')
    })

    it('reject 回 idle 不卡死，onActionError 收到错误', async () => {
        const error = new Error('boom')
        const onAction = vi.fn().mockRejectedValue(error)
        const onActionError = vi.fn()
        render(<ActionButton label="保存" onAction={onAction} onActionError={onActionError} />)

        const btn = screen.getByRole('button', { name: '保存' })
        fireEvent.click(btn)

        await waitFor(() => expect(btn.dataset.state).toBe('idle'))
        expect(btn).toHaveAttribute('aria-busy', 'false')
        expect(onActionError).toHaveBeenCalledWith(error)
    })

    it('disabled 不触发动作', () => {
        const onAction = vi.fn()
        render(<ActionButton label="保存" disabled onAction={onAction} />)

        const btn = screen.getByRole('button', { name: '保存' })
        expect(btn).toBeDisabled()
        fireEvent.click(btn)
        expect(onAction).not.toHaveBeenCalled()
    })
})
