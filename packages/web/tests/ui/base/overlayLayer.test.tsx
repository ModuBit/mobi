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
 * 移动端弹层层号契约（overlayLayer）：
 * - 后领的更大 = 后打开的压在先打开的上面（不分 antd / shadcn 来源）
 * - antd 侧按 `open` 领号：关闭期间不参与层序、每次打开重领（常驻挂载不领旧号）
 *
 * 真机来源：菜单（BottomSheet，1080 起）里长按会话弹出的操作菜单是 antd Drawer（默认 z
 * 1000）→ 压在菜单下面；关掉菜单再开时若沿用挂载时领的旧号，还会继续被后开的浮层压住。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { nextOverlayLayer, retainOverlayLayer, useOpenOverlayLayer, __resetOverlayLayerForTest } from '@/ui/base/layout/overlayLayer'

describe('overlayLayer', () => {
    // 发号状态是模块级单例，跨用例清场（否则「回到低位」的断言依赖前序用例的消耗量）
    beforeEach(() => __resetOverlayLayerForTest())
    afterEach(() => vi.restoreAllMocks())

    it('后领的号更大（含 antd 弹层默认的 1000 起之上）', () => {
        const a = nextOverlayLayer()
        const b = nextOverlayLayer()
        expect(b).toBeGreaterThan(a)
        expect(a).toBeGreaterThan(1000)
    })

    it('antd 侧：打开时领号，关闭期间不参与层序；关掉再开仍守在 1000 之上', () => {
        const { result, rerender } = renderHook(({ open }: { open: boolean }) => useOpenOverlayLayer(open), {
            initialProps: { open: false },
        })
        expect(result.current).toBeUndefined()

        rerender({ open: true })
        const first = result.current
        expect(first).toBeGreaterThan(1000)

        rerender({ open: false })
        expect(result.current).toBeUndefined()

        rerender({ open: true })
        expect(result.current).toBeGreaterThan(1000)
    })

    it('后打开的压在先打开的上面（真机：菜单里的操作菜单要压住菜单）', () => {
        const first = nextOverlayLayer()
        const release = retainOverlayLayer()
        const second = nextOverlayLayer()
        expect(second).toBeGreaterThan(first)
        release()
    })

    it('释放后立刻再领号**不复用**：旧浮层还在播离场动画，它自己的 z 是基准 + 1', () => {
        const release = retainOverlayLayer()
        const exiting = nextOverlayLayer()
        release()
        // 关掉到真消失之间还有一段动画（antd 侧按 open 释放，组件并不卸载）：此刻把号收回去
        // 重发，新浮层的遮罩（基准）就落在正在滑出的旧浮层主体（基准 + 1）之下 = 旧压新
        const incoming = nextOverlayLayer()
        expect(incoming).toBeGreaterThan(exiting)
    })

    it('静默一段（无人领号）后归零：不单调爬过 antd message 的 z', () => {
        const release = retainOverlayLayer()
        release()
        let now = 0
        vi.spyOn(Date, 'now').mockImplementation(() => now)

        // 窗口内领号：仍然递增（离场动画可能还没播完）
        const early = nextOverlayLayer()
        const hold = retainOverlayLayer()
        const mid = nextOverlayLayer()
        expect(mid).toBeGreaterThan(early)

        hold()
        now += 1000
        const afterIdle = nextOverlayLayer()
        expect(afterIdle).toBeLessThan(mid)
        expect(afterIdle).toBeGreaterThan(1000)
    })
})
