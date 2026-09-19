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
 * sketchFile 纯函数层单元测试：草图像素数据的进出口语义中可在 jsdom 断言的部分
 * （文件命名 / 导出尺寸约束 / 格式常量）。excalidraw 导出链路（blob→场景）依赖
 * 浏览器 canvas，由 E2E 覆盖。
 */

import { describe, expect, it } from 'vitest'
import {
    SKETCH_FORMAT,
    SKETCH_MAX_EDGE,
    SKETCH_MARK,
    sketchFilename,
    sketchExportDimensions,
} from '@/domain/sketch/sketchFile'

describe('sketchFilename', () => {
    it('草图-<本地时间戳>.excalidraw.png，两位补零', () => {
        // 本地时区 2026-09-19 09:05:03
        const date = new Date(2026, 8, 19, 9, 5, 3)
        expect(sketchFilename(date)).toBe('草图-20260919-090503.excalidraw.png')
    })

    it('默认参数取当前时间（只验证形状）', () => {
        expect(sketchFilename()).toMatch(/^草图-\d{8}-\d{6}\.excalidraw\.png$/)
    })
})

describe('sketchExportDimensions（导出限长边，图片 token 按像素尺寸计）', () => {
    it('内容小于上限：原尺寸 1:1 导出', () => {
        expect(sketchExportDimensions(800, 600)).toEqual({ width: 800, height: 600, scale: 1 })
    })

    it('长边超上限：等比缩小到长边恰好等于上限', () => {
        const r = sketchExportDimensions(4000, 2000)
        expect(r.scale).toBeCloseTo(0.5)
        expect(r.width).toBe(2000)
        expect(r.height).toBe(1000)
    })

    it('竖版长边同样受限', () => {
        const r = sketchExportDimensions(1000, 4000)
        expect(r.scale).toBeCloseTo(0.5)
        expect(r.width).toBe(500)
        expect(r.height).toBe(2000)
    })
})

describe('格式常量（协议 sketch 标记与文件扩展名的单一来源）', () => {
    it('format 标识与扩展名对齐', () => {
        expect(SKETCH_FORMAT).toBe('excalidraw')
        expect(SKETCH_MARK).toEqual({ format: SKETCH_FORMAT })
        expect(SKETCH_MAX_EDGE).toBe(2000)
    })
})
