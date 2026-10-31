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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PixelAvatar } from '@/ui/pixel-avatar/PixelAvatar'
import { SpriteRenderer } from '@/ui/pixel-avatar/sprites/renderer'

/**
 * 像素小人动画性能契约与 animated prop 行为。
 *
 * 背景（2026-10-31）：旧实现是 rAF 逐帧循环 + 回调内节流，只要页面有头像挂载
 * 就恒定 60 次/秒唤醒，实测静置单核 ~16%。契约：动画默认关闭（animated 默认
 * false，仅静态帧，零循环调度）；开启后动画按 anim.interval 调度推进（idle
 * 350ms → 3s 内 ~8 次绘制），调度唤醒不随帧率空转。
 */

// jsdom 无 2d context：SpriteRenderer 用到的四个方法 stub 掉
function stubContext(): CanvasRenderingContext2D {
    return { clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/** 渲染并推进 elapsed ms，返回 [绘制次数, rAF 调用次数] */
function renderAndAdvance(status: 'idle' | 'outputting', elapsed: number, animated?: boolean): [number, number] {
    const renderSpy = vi.spyOn(SpriteRenderer.prototype, 'renderFrame')
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    render(<PixelAvatar name="tester" status={status} size={18} animated={animated} />)
    vi.advanceTimersByTime(elapsed)
    return [renderSpy.mock.calls.length, rafSpy.mock.calls.length]
}

describe('pixel-avatar 动画性能契约（animated）', () => {
    it('animated：3s 内按 idle interval(350ms) 推进 ~8 帧，且不逐帧占 rAF', () => {
        const [draws, rafs] = renderAndAdvance('idle', 3000, true)
        // 350ms 间隔 3s ≈ 8 帧（基线帧 + 8 次 tick），给出调度抖动余量
        expect(draws).toBeGreaterThanOrEqual(8)
        expect(draws).toBeLessThanOrEqual(11)
        // 性能契约核心：调度不是 60fps rAF 空转（旧实现 3s 需 180 次）
        expect(rafs).toBeLessThanOrEqual(12)
    })

    it('animated：outputting(120ms) 间隔按更快节奏推进', () => {
        const [draws] = renderAndAdvance('outputting', 1300, true)
        // 120ms 间隔 1.3s ≈ 10 帧（基线 + ~10 tick）
        expect(draws).toBeGreaterThanOrEqual(9)
        expect(draws).toBeLessThanOrEqual(13)
    })

    it('默认关闭（不传 animated）：仅初始静态帧，无任何循环调度', () => {
        const [draws, rafs] = renderAndAdvance('idle', 3000)
        expect(draws).toBe(1)
        expect(rafs).toBe(0)
    })

    it('运行中切换 prop 即时生效：开→动起来，关→停住', () => {
        const renderSpy = vi.spyOn(SpriteRenderer.prototype, 'renderFrame')
        const { rerender } = render(<PixelAvatar name="tester" status="idle" size={18} />)
        vi.advanceTimersByTime(1000)
        expect(renderSpy.mock.calls.length).toBe(1)

        rerender(<PixelAvatar name="tester" status="idle" size={18} animated />)
        vi.advanceTimersByTime(1100)
        const drawsOn = renderSpy.mock.calls.length
        expect(drawsOn).toBeGreaterThanOrEqual(3)

        rerender(<PixelAvatar name="tester" status="idle" size={18} />)
        const drawsAt = renderSpy.mock.calls.length
        vi.advanceTimersByTime(2000)
        expect(renderSpy.mock.calls.length).toBe(drawsAt)
    })

    it('多头像共享调度器：第二个头像挂载不重复循环，按最小 interval 推进', () => {
        const renderSpy = vi.spyOn(SpriteRenderer.prototype, 'renderFrame')
        render(
            <>
                <PixelAvatar name="a" status="idle" size={18} animated />
                <PixelAvatar name="b" status="idle" size={72} animated />
            </>,
        )
        vi.advanceTimersByTime(3000)
        // 两个头像各 ~9 次绘制（基线 + 8 tick），共享一个 timer 不加倍唤醒
        expect(renderSpy.mock.calls.length).toBeGreaterThanOrEqual(16)
        expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(24)
    })

    it('静态与动画混挂：仅 animated 头像推进绘制', () => {
        const renderSpy = vi.spyOn(SpriteRenderer.prototype, 'renderFrame')
        render(
            <>
                <PixelAvatar name="still" status="idle" size={18} />
                <PixelAvatar name="live" status="idle" size={72} animated />
            </>,
        )
        vi.advanceTimersByTime(3000)
        // 静态头像 1 帧 + 动画头像 ~9 帧
        expect(renderSpy.mock.calls.length).toBeGreaterThanOrEqual(9)
        expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(13)
    })
})
