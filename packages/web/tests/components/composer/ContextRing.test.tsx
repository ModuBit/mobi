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

import { describe, it, expect, vi, afterEach, beforeAll, afterAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ContextRing, resolveRingTone } from '@/components/composer/ContextRing'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import type { ContextUsage } from '@mobi/shared'

// mock 移动端断点（partial mock，默认桌面端；移动端用例 mockReturnValue(true)）
vi.mock('@/core/data/hooks/useMediaQuery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/hooks/useMediaQuery')>()
    return { ...actual, useIsMobile: vi.fn(() => false) }
})
const mockedIsMobile = vi.mocked(useIsMobile)

// mock i18next：contextUsage 命名空间映射中文词，其余透传 key（initReactI18next 必须 noop 导出，
// 避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const dict: Record<string, string> = {
                'session.contextUsage.title': '上下文水位',
                'session.contextUsage.used': '已用',
                'session.contextUsage.remaining': '剩余',
                'session.contextUsage.cost': '累计成本',
                'session.contextUsage.input': '输入',
                'session.contextUsage.output': '输出',
                'session.contextUsage.cacheRead': '缓存读',
                'session.contextUsage.cacheWrite': '缓存写',
            }
            return dict[key] ?? key
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

beforeEach(() => {
    mockedIsMobile.mockReturnValue(false)
})

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

    it('点击后 Popover 展示已用/上限/百分比/成本（数字 k/m 归一）', async () => {
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        // Popover 内容 portal 到 body，异步挂载
        await waitFor(() => {
            expect(document.body.textContent).toContain('13k / 100k (13%)')
        })
        expect(document.body.textContent).toContain('$0.42')
        // 剩余行：label + 归一数值（87,000 → 87k）
        expect(document.body.textContent).toContain('剩余')
        expect(document.body.textContent).toContain('87k')
    })

    it('有细分数据也不渲染瞬时请求细分组（输入/输出/缓存读/缓存写/命中率整组移除）', async () => {
        render(<ContextRing usage={makeUsage({
            totalTokens: 128943, maxTokens: 1_000_000, percentage: 12.89,
            inputTokens: 1199, outputTokens: 744, cacheReadTokens: 127744, cacheCreationTokens: 256,
        })} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        await waitFor(() => {
            expect(document.body.textContent).toContain('129k / 1.0m (13%)')
        })
        const text = document.body.textContent!
        // 细分五行都是单轮瞬时数字，放水位视图说明不了什么（命中率也只是本轮 prompt 内的
        // 缓存覆盖比、非累计命中率）——整组移除，只留水位/剩余/成本概要
        expect(text).not.toContain('输入')
        expect(text).not.toContain('输出')
        expect(text).not.toContain('缓存读')
        expect(text).not.toContain('缓存写')
        expect(text).not.toContain('缓存命中')
    })

    it('hover 圆环 Tooltip 展示已用概要（143k / 1.0m (14%) 形态），点击行为不变', async () => {
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.mouseEnter(screen.getByRole('button', { name: '13%' }))
        // Tooltip 同样 portal 到 body，但 hover 不打开 Popover（触发分离：hover=tooltip / click=popover）
        await waitFor(() => {
            expect(document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)').length).toBe(1)
        })
        expect(document.body.textContent).toContain('13k / 100k (13%)')
    })

    it('Popover 打开后 Tooltip 隐藏（两者同屏重叠）', async () => {
        render(<ContextRing usage={makeUsage()} />)
        const ring = screen.getByRole('button', { name: '13%' })
        fireEvent.mouseEnter(ring)
        await waitFor(() => {
            expect(document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)').length).toBe(1)
        })
        fireEvent.click(ring)
        await waitFor(() => {
            expect(document.body.textContent).toContain('累计成本') // Popover 已开
        })
        // jsdom 不触发 CSS transition，rc-motion 退场不完成——模拟浏览器动画结束事件
        const tip = document.querySelector('.ant-tooltip')
        if (tip) fireEvent.transitionEnd(tip)
        await waitFor(() => {
            expect(document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)').length).toBe(0)
        })
    })

    it('移动端不渲染 Tooltip（无 hover，tap 直开 Popover）', async () => {
        mockedIsMobile.mockReturnValue(true)
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.mouseEnter(screen.getByRole('button', { name: '13%' }))
        await new Promise((r) => setTimeout(r, 300)) // 越过 mouseEnterDelay，确认永不弹出
        expect(document.querySelectorAll('.ant-tooltip').length).toBe(0)
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

    it('衰减刻度线：1M 窗口渲染两根（200k@20% 角度、400k@40% 角度）', () => {
        render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000, percentage: 13 })} />)
        const lines = document.querySelectorAll('svg[role="button"] line')
        expect(lines.length).toBe(2)
        // 第一根 20% 角度（顶部起顺时针 72°）：外端 x≈23.89, y≈8.14
        expect(Number(lines[0].getAttribute('x2'))).toBeCloseTo(23.89, 1)
        expect(Number(lines[0].getAttribute('y2'))).toBeCloseTo(8.14, 1)
        // 第二根 40% 角度（144°）：外端 x≈19.35, y≈22.11
        expect(Number(lines[1].getAttribute('x2'))).toBeCloseTo(19.35, 1)
        expect(Number(lines[1].getAttribute('y2'))).toBeCloseTo(22.11, 1)
    })

    it('衰减刻度线退化：窗口 ≤200k 不渲染任何刻度；400k 窗口只渲染 200k 一根', () => {
        const { unmount } = render(<ContextRing usage={makeUsage({ maxTokens: 200_000, percentage: 13 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()
        unmount()
        render(<ContextRing usage={makeUsage({ maxTokens: 100_000, percentage: 13 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()
        unmount()
        render(<ContextRing usage={makeUsage({ maxTokens: 400_000, percentage: 13 })} />)
        expect(document.querySelectorAll('svg[role="button"] line').length).toBe(1)
    })
})
