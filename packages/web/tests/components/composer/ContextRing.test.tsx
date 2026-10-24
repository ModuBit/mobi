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
import { ContextRing, resolveRingTone } from '@/ui/shared/ContextRing'
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
                'session.contextUsage.modelLimit': '模型上限',
                'session.contextUsage.autoCompact': '自动压缩',
                'session.contextUsage.compact': '立即压缩',
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
    /** percentage 是后端契约字段（= total / max），测试夹具保持一致 */
    const make = (totalTokens: number, maxTokens = 100_000, extra: Partial<ContextUsage> = {}) => ({
        totalTokens, maxTokens, percentage: maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0, ...extra,
    })

    // 无压缩阈值 → 回落到窗口百分比（与旧口径同义）
    it('无阈值时按窗口百分比四档：<50 idle / 50–70 notice / 70–85 warn / ≥85 danger', () => {
        expect(resolveRingTone(make(0))).toEqual({ pct: 0, tone: 'idle', limitUsage: 0 })
        expect(resolveRingTone(make(49_400)).tone).toBe('idle')
        expect(resolveRingTone(make(49_500)).tone).toBe('notice') // 49.5 → 四舍五入 50
        expect(resolveRingTone(make(69_400)).tone).toBe('notice')
        expect(resolveRingTone(make(69_500)).tone).toBe('warn') // 69.5 → 四舍五入 70
        expect(resolveRingTone(make(84_400)).tone).toBe('warn')
        expect(resolveRingTone(make(85_000))).toEqual({ pct: 85, tone: 'danger', limitUsage: 85 })
    })

    // 阈值远小于窗口时，红档不再「永远不出现」
    it('有阈值时分档相对阈值，弧长/百分比仍按窗口', () => {
        // 1m 窗口 / 350k 阈值：315k = 31.5% 窗口，但已到 90% 阈值 → danger
        expect(resolveRingTone(make(315_000, 1_000_000, { autoCompactAtTokens: 350_000 })))
            .toEqual({ pct: 32, tone: 'danger', limitUsage: 90 })
        // 200k = 57% 阈值 → notice（过半但还从容），262.5k = 75% → warn
        expect(resolveRingTone(make(200_000, 1_000_000, { autoCompactAtTokens: 350_000 })).tone).toBe('notice')
        expect(resolveRingTone(make(262_500, 1_000_000, { autoCompactAtTokens: 350_000 })).tone).toBe('warn')
    })

    it('阈值超过窗口时以窗口为上限（窗口先撞到）', () => {
        expect(resolveRingTone(make(90_000, 100_000, { autoCompactAtTokens: 200_000 })))
            .toEqual({ pct: 90, tone: 'danger', limitUsage: 90 })
    })

    it('百分比钳位到 [0, 100]，小数四舍五入', () => {
        expect(resolveRingTone({ totalTokens: 120_000, maxTokens: 100_000, percentage: 120 }).pct).toBe(100)
        expect(resolveRingTone({ totalTokens: -5, maxTokens: 100_000, percentage: -5 }).pct).toBe(0)
        expect(resolveRingTone({ totalTokens: 49_400, maxTokens: 100_000, percentage: 49.4 }).pct).toBe(49)
        expect(resolveRingTone({ totalTokens: 49_500, maxTokens: 100_000, percentage: 49.5 }).pct).toBe(50)
    })

    it('窗口为 0 不除零（全 0 读数 → idle）', () => {
        expect(resolveRingTone({ totalTokens: 0, maxTokens: 0, percentage: 0 })).toEqual({ pct: 0, tone: 'idle', limitUsage: 0 })
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

    it('模型上限行：modelContextTokens 与 maxTokens 不同才渲染（信息展示，不作分母）', async () => {
        // CC 有效窗口 350k 作分母，模型最大 1m 单独展示
        render(<ContextRing usage={makeUsage({
            maxTokens: 350_000,
            modelContextTokens: 1_000_000,
        })} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        await waitFor(() => {
            expect(document.body.textContent).toContain('模型上限')
        })
        expect(document.body.textContent).toContain('1.0m')

        // 与分母一致（未设 autocompact）→ 省略该行
        cleanup()
        render(<ContextRing usage={makeUsage({ maxTokens: 100_000, modelContextTokens: 100_000 })} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        await waitFor(() => {
            expect(document.body.textContent).toContain('剩余')
        })
        expect(document.body.textContent).not.toContain('模型上限')
    })

    it('自动压缩阈值行：阈值已知才渲染（颜色分档的可读依据）', async () => {
        render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000, autoCompactAtTokens: 350_000 })} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => {
            expect(document.body.textContent).toContain('自动压缩')
        })
        expect(document.body.textContent).toContain('350k')

        cleanup()
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => {
            expect(document.body.textContent).toContain('累计成本')
        })
        expect(document.body.textContent).not.toContain('自动压缩')
    })

    it('阈值口径接入组件：31.5% 窗口但 90% 阈值 → 弧色进入砖红档；同读数无阈值仍是灰档', () => {
        // jsdom 的 cssstyle 不支持 animation 简写（style.animation 恒为空串），故断言弧色
        const arcStroke = (usage: ContextUsage) => {
            const { unmount } = render(<ContextRing usage={usage} />)
            const stroke = document.querySelectorAll('svg[role="button"] circle')[1].getAttribute('stroke')
            unmount()
            return stroke
        }
        const base = makeUsage({ totalTokens: 315_000, maxTokens: 1_000_000, percentage: 31.5 })
        // 1m 窗口 / 350k 阈值：315k 只占窗口 31.5%，但已到阈值 90%
        expect(arcStroke({ ...base, autoCompactAtTokens: 350_000 })).not.toBe(arcStroke(base))
    })

    it('压缩按钮：低水位不展示，≥60% 出现，点击回调并收起面板', async () => {
        const onCompact = vi.fn()
        // 13% → idle：不渲染
        render(<ContextRing usage={makeUsage()} onCompact={onCompact} />)
        fireEvent.click(screen.getByRole('button', { name: '13%' }))
        await waitFor(() => expect(document.body.textContent).toContain('累计成本'))
        expect(screen.queryByRole('button', { name: '立即压缩' })).toBeNull()
        cleanup()

        // 60% → 按钮门槛（环身仍是 notice 石青）：出现；点击回调并收起
        render(<ContextRing usage={makeUsage({ totalTokens: 60_000, maxTokens: 100_000, percentage: 60 })} onCompact={onCompact} />)
        fireEvent.click(screen.getByRole('button', { name: '60%' }))
        fireEvent.click(await screen.findByRole('button', { name: '立即压缩' }))
        expect(onCompact).toHaveBeenCalledTimes(1)
        await waitFor(() => expect(screen.queryByText('累计成本')).toBeNull())
    })

    it('压缩按钮：running 中置灰；未注入 onCompact 时不渲染', async () => {
        render(<ContextRing usage={makeUsage({ totalTokens: 60_000, maxTokens: 100_000, percentage: 60 })} onCompact={vi.fn()} compactDisabled />)
        fireEvent.click(screen.getByRole('button', { name: '60%' }))
        const btn = await screen.findByRole('button', { name: '立即压缩' })
        expect((btn as HTMLButtonElement).disabled).toBe(true)
        cleanup()

        // 未提供回调 → 即使高水位也没有动作可执行
        render(<ContextRing usage={makeUsage({ totalTokens: 60_000, maxTokens: 100_000, percentage: 60 })} />)
        fireEvent.click(screen.getByRole('button', { name: '60%' }))
        await waitFor(() => expect(document.body.textContent).toContain('累计成本'))
        expect(screen.queryByRole('button', { name: '立即压缩' })).toBeNull()
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
        fireEvent.pointerOver(screen.getByRole('button', { name: '13%' }), { pointerType: 'mouse', relatedTarget: document.body })
        // Tooltip 同样 portal 到 body，但 hover 不打开 Popover（触发分离：hover=tooltip / click=popover）
        await waitFor(() => {
            expect(document.querySelectorAll('[role="tooltip"][data-state$="open"]').length).toBe(1)
        })
        expect(document.body.textContent).toContain('13k / 100k (13%)')
    })

    it('Popover 打开后 Tooltip 隐藏（两者同屏重叠）', async () => {
        render(<ContextRing usage={makeUsage()} />)
        const ring = screen.getByRole('button', { name: '13%' })
        fireEvent.pointerOver(ring, { pointerType: 'mouse', relatedTarget: document.body })
        await waitFor(() => {
            expect(document.querySelectorAll('[role="tooltip"][data-state$="open"]').length).toBe(1)
        })
        fireEvent.click(ring)
        await waitFor(() => {
            expect(document.body.textContent).toContain('累计成本') // Popover 已开
        })
        await waitFor(() => {
            expect(document.querySelectorAll('[role="tooltip"][data-state$="open"]').length).toBe(0)
        })
    })

    it('移动端不渲染 Tooltip（无 hover，tap 直开 Popover）', async () => {
        mockedIsMobile.mockReturnValue(true)
        render(<ContextRing usage={makeUsage()} />)
        fireEvent.pointerOver(screen.getByRole('button', { name: '13%' }), { pointerType: 'mouse', relatedTarget: document.body })
        await new Promise((r) => setTimeout(r, 300)) // 越过 mouseEnterDelay，确认永不弹出
        expect(document.querySelectorAll('[role="tooltip"]').length).toBe(0)
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

    it('自动压缩刻度：阈值/窗口角度处画一根线（不再写死 200k/400k）', () => {
        render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000, percentage: 13, autoCompactAtTokens: 350_000 })} />)
        const lines = document.querySelectorAll('svg[role="button"] line')
        expect(lines.length).toBe(1)
        // 35% 角度（顶部起顺时针 126°）：外端 x≈22.11, y≈19.35
        expect(Number(lines[0].getAttribute('x2'))).toBeCloseTo(22.11, 1)
        expect(Number(lines[0].getAttribute('y2'))).toBeCloseTo(19.35, 1)
    })

    it('自动压缩刻度缺省或越界（≥窗口）→ 不渲染线', () => {
        const { unmount } = render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()  // 无阈值：不猜 200k/400k
        unmount()
        render(<ContextRing usage={makeUsage({ maxTokens: 1_000_000, autoCompactAtTokens: 1_000_000 })} />)
        expect(document.querySelector('svg[role="button"] line')).toBeNull()
    })
})

// 带类目细分的 usage（夹具风格同 ContextBreakdown.test.tsx）
const usageWithBreakdown = {
    totalTokens: 68300,
    maxTokens: 200000,
    percentage: 34,
    costUsd: 1.24,
    breakdown: {
        categories: [
            { key: 'systemPrompt', tokens: 18200 },
            { key: 'systemTools', tokens: 9600 },
            { key: 'mcpTools', tokens: 12400 },
            { key: 'memoryFiles', tokens: 8900 },
            { key: 'skills', tokens: 6800 },
            { key: 'messages', tokens: 12100 },
        ],
        freeTokens: 112000,
        autocompactBufferTokens: 20000,
        mcpTools: [
            { name: 'context7', tokens: 4100 },
            { name: 'mobi-web', tokens: 3200 },
        ],
        skills: [{ name: 'superpowers', tokens: 2400 }],
        memoryFiles: [{ path: '~/.claude/CLAUDE.md', tokens: 4200 }],
    },
} as unknown as ContextUsage

describe('ContextRing 细分挂载', () => {
    afterEach(cleanup)

    it('usage.breakdown 存在时 Popover 内渲染类目细分段', async () => {
        render(<ContextRing usage={usageWithBreakdown} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => expect(screen.getByText('System prompt')).toBeTruthy())
    })

    it('breakdown 缺省时不渲染细分段（退化现状）', async () => {
        render(<ContextRing usage={makeUsage({ totalTokens: 68300, maxTokens: 200_000, percentage: 34 })} />)
        fireEvent.click(screen.getByRole('button'))
        await waitFor(() => expect(screen.getByText(/200/)).toBeTruthy()) // 概要行照常
        expect(screen.queryByText('System prompt')).toBeNull()
    })
})
