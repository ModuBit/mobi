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

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'

// motion 整体打桩：只保留 DOM 语义（div/button/span 原样渲染，动画 props 剥离），
// AnimatePresence 直通——jsdom 下 motion 的 rAF 动画没有断言价值（spec 验收：
// 状态机流转与回调时序是本组件的测试对象，动画表现归真机肉眼验收）
vi.mock('motion/react', async (importOriginal) => {
    const { createElement, forwardRef } = await import('react')
    const stub = (tag: string) =>
        forwardRef(function MotionStub(props: Record<string, unknown>, ref) {
            const { initial, animate, exit, transition, whileTap, variants, ...rest } = props
            return createElement(tag, { ...rest, ref })
        })
    return {
        motion: new Proxy({}, { get: (_, tag: string) => stub(tag) }),
        AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
        useReducedMotion: () => false,
    }
})

const { TwoStepConfirmButton } = await import('@/components/ui/TwoStepConfirmButton')

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => ({ 'common.confirm': '确认', 'common.cancel': '取消' })[key] ?? key,
    }),
}))

beforeAll(() => {
    // jsdom 无 PointerEvent，外点关闭监听用 PointerEvent 挂 document
    if (!window.PointerEvent) {
        // @ts-expect-error 测试环境补桩
        window.PointerEvent = class PointerEvent extends MouseEvent {}
    }
})

afterEach(cleanup)

function renderButton(overrides?: Partial<Parameters<typeof TwoStepConfirmButton>[0]>) {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const utils = render(
        <ConfigProvider>
            <TwoStepConfirmButton
                icon={<span data-testid="idle-icon" />}
                ariaActionLabel="停止任务"
                onConfirm={onConfirm}
                onCancel={onCancel}
                {...overrides}
            />
        </ConfigProvider>,
    )
    return { onConfirm, onCancel, ...utils }
}

describe('TwoStepConfirmButton', () => {
    it('空闲态只有触发按钮，无确认面板', () => {
        const { container } = renderButton()
        expect(screen.getByRole('button', { name: '停止任务' })).toBeInTheDocument()
        expect(container.querySelector('[data-state="open"]')).toBeNull()
    })

    it('一击展开：出现确认/取消面板，aria-expanded 置真', () => {
        const { container } = renderButton()
        fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
        expect(container.querySelector('[data-state="open"]')).not.toBeNull()
        expect(screen.getByRole('button', { name: '确认 停止任务' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '取消 停止任务' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '停止任务' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('点 ✓ 立即触发 onConfirm，进入 confirmed 停留态后回 idle', () => {
        vi.useFakeTimers()
        try {
            const { onConfirm, container } = renderButton()
            fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
            fireEvent.click(screen.getByRole('button', { name: '确认 停止任务' }))
            expect(onConfirm).toHaveBeenCalledTimes(1)
            expect(container.querySelector('[data-status="confirmed"]')).not.toBeNull()
            act(() => { vi.advanceTimersByTime(1400) })
            expect(container.querySelector('[data-status="idle"]')).not.toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    it('Escape 触发 onCancel 并复原', () => {
        const { onConfirm, onCancel, container } = renderButton()
        fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
        fireEvent.keyDown(container.querySelector('[data-testid="two-step-confirm"]')!, { key: 'Escape' })
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(onConfirm).not.toHaveBeenCalled()
        expect(container.querySelector('[data-state="closed"]')).not.toBeNull()
    })

    it('展开态超时自动复原并回调 onCancel', () => {
        vi.useFakeTimers()
        try {
            const { onCancel, container } = renderButton({ timeoutMs: 3000 })
            fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
            expect(container.querySelector('[data-state="open"]')).not.toBeNull()
            act(() => { vi.advanceTimersByTime(3000) })
            expect(container.querySelector('[data-state="closed"]')).not.toBeNull()
            expect(onCancel).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it('disabled 时点击不展开', () => {
        const { container } = renderButton({ disabled: true })
        fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
        expect(container.querySelector('[data-state="open"]')).toBeNull()
    })

    it('expandedIcon 插槽：展开时换 icon，空闲回落 icon', () => {
        const { container } = renderButton({ expandedIcon: <span data-testid="expanded-icon" /> })
        expect(screen.queryByTestId('expanded-icon')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '停止任务' }))
        expect(screen.getByTestId('expanded-icon')).toBeInTheDocument()
        expect(container.querySelector('[data-state="open"]')).not.toBeNull()
    })
})
