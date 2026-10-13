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
 * 多档释放的落档契约（BottomSheet 的停靠点）：慢放按「松手位置 + 速度投影」选最近档，
 * 快甩至少跨一档（方向由速度符号定，且不许越出两端）。三档取 [top, peek, closed]。
 */

import { describe, it, expect } from 'vitest'
import { resolveDetentRelease } from '@/ui/base/interactive/resolveDetentRelease'

/** 三档：0 = 全展开，300 = peek，900 = 滑出关闭位 */
const DETENTS = [0, 300, 900]

const release = (offset: number, velocity: number, from: number) =>
    resolveDetentRelease({ offset, velocity, detents: DETENTS, from })

describe('resolveDetentRelease', () => {
    it('慢速释放：按投影位置落最近的档', () => {
        expect(release(40, 0, 0)).toBe(0)
        expect(release(280, 0, 1)).toBe(1)
        expect(release(860, 0, 1)).toBe(2)
    })

    it('投影把落点推过档界（0.2s 的向前投影，不看当前位置）', () => {
        // 位置在 peek（300）附近但带下甩速度：投影 300 + 500×0.2 = 400 → 仍最近 peek
        expect(release(300, 100, 1)).toBe(1)
        expect(release(560, 500, 1)).toBe(2)
        // 位置上已在关闭位附近但带上推速度 → 投影回 peek
        expect(release(880, -500, 2)).toBe(1)
    })

    it('快甩（|v| > 320）至少跨一档：方向由速度符号定', () => {
        // 停在展开档往下快甩 → 至少进 peek（哪怕投影还指着 top）
        expect(release(20, 400, 0)).toBe(1)
        // 停在 peek 往下快甩 → 直接关闭
        expect(release(280, 400, 1)).toBe(2)
        // 停在关闭位往上快甩 → 至少回到 peek
        expect(release(900, -400, 2)).toBe(1)
        // 停在 peek 往上快甩 → 回到展开档
        expect(release(320, -400, 1)).toBe(0)
    })

    it('快甩不越出两端：起手档在两极时跨档被钳住', () => {
        // 已在最下档再往下甩：只有三档，不会算出不存在的下标
        expect(release(900, 900, 2)).toBe(2)
        // 已在最上档再往上甩
        expect(release(0, -900, 0)).toBe(0)
    })

    it('两档（矮面板 / peek={false}）：档位重合时行为退化成关闭或回位', () => {
        const two = [0, 900]
        expect(resolveDetentRelease({ offset: 100, velocity: 0, detents: two, from: 0 })).toBe(0)
        expect(resolveDetentRelease({ offset: 800, velocity: 0, detents: two, from: 0 })).toBe(1)
        // 从唯一起手档往下快甩 → 关闭
        expect(resolveDetentRelease({ offset: 100, velocity: 500, detents: two, from: 0 })).toBe(1)
        // 往上快甩已被钳在最上档
        expect(resolveDetentRelease({ offset: 100, velocity: -500, detents: two, from: 0 })).toBe(0)
    })

    it('投影正好落在两档中间：取更靠前的档（平局不下跳）', () => {
        // |0-150| 与 |300-150| 相等 → 保留先遍历到的下标 0
        expect(release(150, 0, 0)).toBe(0)
        expect(release(600, 0, 1)).toBe(1)
    })
})
