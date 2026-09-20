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
 * sketchLayout 不变量测试：画布 settle 延迟必须盖过载体全部动画时长——
 * 否则动画 transform 中间态被 excalidraw 缓存为画布 rect，绘制坐标整体偏移
 * （历史真 bug）。settle 从动画时长派生后，此断言锁住派生关系不回退。
 */

import { describe, it, expect } from 'vitest'
import {
    SKETCH_CANVAS_SETTLE_MS,
    SKETCH_MORPH_MS,
    SKETCH_SHEET_IN_MS,
    SKETCH_SHEET_OUT_MS,
} from '@/domain/sketch/sketchLayout'

describe('sketchLayout 动画时序不变量', () => {
    it('画布 settle 延迟严格大于载体全部动画时长', () => {
        const maxAnimation = Math.max(SKETCH_SHEET_IN_MS, SKETCH_SHEET_OUT_MS, SKETCH_MORPH_MS)
        expect(SKETCH_CANVAS_SETTLE_MS).toBeGreaterThan(maxAnimation)
    })
})
