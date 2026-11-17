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
 * 药丸宽度测量契约：首报/reduced 直接回 auto；变宽变窄各用一支弹簧；
 * 起飞前钉旧宽；亚像素抖动忽略；过期飞行不得把新飞行抹回 auto。
 */

import { describe, expect, it, vi } from 'vitest'
import { motionValue } from 'motion/react'
import type { Transition } from 'motion/react'
import { createFaceWidthOracle } from '@/ui/base/interactive/confirm-morph/faceWidth'
import type { FaceWidthAnimate } from '@/ui/base/interactive/confirm-morph/faceWidth'

const GROW: Transition = { type: 'spring', stiffness: 1 }
const SHRINK: Transition = { type: 'spring', stiffness: 2 }

function setup() {
    const width = motionValue<number | 'auto'>('auto')
    const flights: { to: number; transition: Transition | undefined; land: () => void }[] = []
    const animate: FaceWidthAnimate = (value, to, transition) => ({
        then: onFulfilled => {
            flights.push({ to, transition, land: onFulfilled })
        },
    })
    const oracle = createFaceWidthOracle({ width, animate, grow: GROW, shrink: SHRINK })
    return { width, flights, oracle }
}

describe('createFaceWidthOracle', () => {
    it('首报无起点 → 直接回 auto，不起飞', () => {
        const { width, flights, oracle } = setup()
        oracle.report(96.5, false)
        expect(flights).toHaveLength(0)
        expect(width.get()).toBe('auto')
    })

    it('变宽 → 钉旧目标后以 grow 弹簧起飞，落地回 auto', () => {
        const { width, flights, oracle } = setup()
        oracle.report(96.5, false)
        oracle.report(140.25, false)
        expect(flights).toHaveLength(1)
        expect(flights[0].to).toBe(140.25)
        expect(flights[0].transition).toBe(GROW)
        // 起飞前把宽度钉在上一面的自然宽
        expect(width.get()).toBe(96.5)
        flights[0].land()
        expect(width.get()).toBe('auto')
    })

    it('变窄 → 用 shrink 弹簧（不过冲）', () => {
        const { flights, oracle } = setup()
        oracle.report(140, false)
        oracle.report(96, false)
        expect(flights[0].transition).toBe(SHRINK)
    })

    it('亚像素抖动（<0.25px）不改变目标', () => {
        const { flights, oracle } = setup()
        oracle.report(100, false)
        oracle.report(100.2, false)
        expect(flights).toHaveLength(0)
    })

    it('reduced-motion → 直接回 auto，不起飞', () => {
        const { flights, oracle } = setup()
        oracle.report(100, false)
        oracle.report(160, true)
        expect(flights).toHaveLength(0)
    })

    it('过期飞行的完成回调不回写 auto（新飞行仍在途中）', () => {
        const { width, flights, oracle } = setup()
        oracle.report(100, false)
        oracle.report(150, false)
        oracle.report(200, false)
        expect(flights).toHaveLength(2)
        // 第一次飞行晚到：token 已过期，不得把宽度抹回 auto
        flights[0].land()
        expect(width.get()).not.toBe('auto')
        // 当前飞行的落地回调照常回 auto
        flights[1].land()
        expect(width.get()).toBe('auto')
    })

    it('飞行途中继续测量：方向按当前实际宽度判定', () => {
        const { width, flights, oracle } = setup()
        oracle.report(100, false)
        oracle.report(150, false) // 起飞到 150，但假 animate 不推进值：实际宽度停在 100
        oracle.report(130, false) // 目标 130 仍大于当前 100 → grow
        expect(flights).toHaveLength(2)
        expect(flights[1].to).toBe(130)
        expect(flights[1].transition).toBe(GROW)
        expect(width.get()).toBe(100)
    })
})

describe('createFaceWidthOracle（接线自检）', () => {
    it('重复上报同一自然宽不重复起飞（ResizeObserver 多次回调）', () => {
        const { flights, oracle } = setup()
        oracle.report(120, false)
        oracle.report(120, false)
        oracle.report(120, false)
        expect(flights).toHaveLength(0)
    })

    it('land 回调只 jump auto，不改目标（下一面从上一面自然宽起步）', () => {
        const { width, flights, oracle } = setup()
        oracle.report(120, false)
        oracle.report(160, false)
        flights[0].land()
        expect(width.get()).toBe('auto')
        // 之后同宽报告（差值仍在阈值内）不再起飞
        oracle.report(160.1, false)
        expect(flights).toHaveLength(1)
    })
})
