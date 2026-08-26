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

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ContextRing, resolveRingTone } from '@/components/composer/ContextRing'
import type { ContextUsage } from '@mobi/shared'

// mock i18next：透传 key 并做 {{tokens}} 插值（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, opts?: { tokens?: string }) => {
            if (key === 'session.contextUsage.remaining') return `剩 ${opts?.tokens ?? ''}`
            return key
        },
    }),
}))

// jsdom 无 ResizeObserver，Popover 打开路径上 @rc-component/resize-observer 依赖——最小 noop 替身
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
const origResizeObserver = globalThis.ResizeObserver
beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
})
afterAll(() => {
    globalThis.ResizeObserver = origResizeObserver
})

// vitest 未开 globals，渲染型测试必须显式 cleanup，否则 DOM 跨用例累积
afterEach(cleanup)

function makeUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        totalTokens: 13000,
        maxTokens: 100000,
        percentage: 13,
        costUsd: 0.42,
        ...overrides,
    }
}

describe('resolveRingTone', () => {
    it('<50 → idle（日常无感）', () => {
        expect(resolveRingTone(0)).toEqual({ pct: 0, tone: 'idle' })
        expect(resolveRingTone(13)).toEqual({ pct: 13, tone: 'idle' })
        expect(resolveRingTone(49.6)).toEqual({ pct: 50, tone: 'notice' }) // 四舍五入到 50 → notice
    })

    it('50-74 → notice（开始注意）', () => {
        expect(resolveRingTone(50)).toEqual({ pct: 50, tone: 'notice' })
        expect(resolveRingTone(74)).toEqual({ pct: 74, tone: 'notice' })
    })

    it('75-89 → warn（该考虑压缩）', () => {
        expect(resolveRingTone(75)).toEqual({ pct: 75, tone: 'warn' })
        expect(resolveRingTone(89)).toEqual({ pct: 89, tone: 'warn' })
    })

    it('≥90 → danger（马上要压缩）', () => {
        expect(resolveRingTone(90)).toEqual({ pct: 90, tone: 'danger' })
        expect(resolveRingTone(100)).toEqual({ pct: 100, tone: 'danger' })
    })

    it('百分比钳位到 [0, 100]', () => {
        expect(resolveRingTone(120).pct).toBe(100)
        expect(resolveRingTone(-5).pct).toBe(0)
    })

    it('小数四舍五入到整数', () => {
        expect(resolveRingTone(49.4)).toEqual({ pct: 49, tone: 'idle' })
        expect(resolveRingTone(49.5)).toEqual({ pct: 50, tone: 'notice' })
    })
})

describe('ContextRing', () => {
    it('渲染 role=button 且 aria-label 含百分比', () => {
        render(<ContextRing usage={makeUsage()} />)
        const ring = screen.getByRole('button', { name: '13%' })
        expect(ring).toBeTruthy()
        expect(ring.tagName.toLowerCase()).toBe('svg')
    })

    it('点击后 Popover 展示已用/上限/百分比/成本', async () => {
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        // Popover 内容 portal 到 body，异步挂载
        await waitFor(() => {
            expect(document.body.textContent).toContain('13,000 / 100,000 (13%)')
        })
        expect(document.body.textContent).toContain('$0.42')
        expect(document.body.textContent).toContain('剩 87k')
    })

    it('usage 全 0 时正常渲染不抛错（灰环，aria-label 0%）', () => {
        expect(() =>
            render(
                <ContextRing
                    usage={makeUsage({ totalTokens: 0, maxTokens: 0, percentage: 0, costUsd: 0 })}
                />,
            ),
        ).not.toThrow()
        expect(screen.getByRole('button', { name: '0%' })).toBeTruthy()
    })

    it('200k 衰减刻度线：1M 窗口（ratio 0.2 <1）渲染 line，位置在 20% 角度', () => {
        render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000, percentage: 13 })} />)
        const line = document.querySelector('svg[role="button"] line')
        expect(line).toBeTruthy()
        // 20% 角度（顶部起顺时针 72°）：外端 x≈23.89, y≈8.14
        expect(Number(line!.getAttribute('x2'))).toBeCloseTo(23.89, 1)
        expect(Number(line!.getAttribute('y2'))).toBeCloseTo(8.14, 1)
    })

    it('200k 衰减刻度线退化：窗口 ≤200k（ratio ≥1）不渲染', () => {
        const { unmount } = render(<ContextRing usage={makeUsage({ maxTokens: 200_000, percentage: 13 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()
        unmount()
        render(<ContextRing usage={makeUsage({ maxTokens: 100_000, percentage: 13 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()
    })
})
