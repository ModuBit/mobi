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
 * viz-calendar 纯逻辑单测（visualize-runtime 票 04）：时间解析与 lane 分配。
 * 组件 DOM/样式面由 E2E 真机验证（viz-verify memory recipe）；这里锁的是
 * 「换实现后仍应成立」的算法语义。
 */

import { describe, test, expect } from 'bun:test'
import { vizTimeToMinutes, assignVizLanes, type VizLaneEvent } from '../../../src/web/vizRuntime/vizCalendar'

/** 便捷构造（from/to 单位分钟） */
const ev = (from: number, to: number): VizLaneEvent => ({ from, to, lane: -1, lanes: -1 })

describe('vizTimeToMinutes', () => {
    test('合法 HH:MM（含 24:00 作窗口 end）', () => {
        expect(vizTimeToMinutes('00:00')).toBe(0)
        expect(vizTimeToMinutes('09:30')).toBe(570)
        expect(vizTimeToMinutes('23:59')).toBe(1439)
        expect(vizTimeToMinutes('24:00')).toBe(1440)
    })

    test('非法值拒绝（错误面向用户）', () => {
        for (const bad of ['24:01', '25:00', '9:00', '09:5', '09-00', '', null, 930, undefined]) {
            expect(() => vizTimeToMinutes(bad)).toThrow()
        }
    })
})

describe('assignVizLanes', () => {
    test('无重叠：全在 lane 0、各成一组 lanes=1', () => {
        const events = [ev(0, 60), ev(60, 120), ev(180, 240)]
        assignVizLanes(events)
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 1], [0, 1], [0, 1]])
    })

    test('相邻共享 lane（end == next from 不算重叠）', () => {
        const events = [ev(0, 60), ev(60, 120)]
        assignVizLanes(events)
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 1], [0, 1]])
    })

    test('两两重叠：lane 0/1，组内共享 lanes=2', () => {
        const events = [ev(0, 60), ev(30, 90)]
        assignVizLanes(events)
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 2], [1, 2]])
    })

    test('重叠链共享列数：链内 3 并发，链外独立（12:00-12:30 两个 + 12:10-12:20 一个）', () => {
        // 排序后输入（render 侧已按 from 升序）
        const events = [ev(720, 750), ev(720, 750), ev(730, 740), ev(780, 840)]
        assignVizLanes(events)
        // 链内三条 lanes=3；780 那条在新组 lanes=1
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 3], [1, 3], [2, 3], [0, 1]])
    })

    test('链式传递（A-B 重叠、B-C 重叠但 A-C 不重叠）：同一组共享列数', () => {
        const events = [ev(0, 60), ev(30, 90), ev(60, 120)]
        assignVizLanes(events)
        // 三条同一重叠链：lanes=2；A/C 各占 lane 0，B 占 lane 1
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 2], [1, 2], [0, 2]])
    })

    test('让位复用：lane 0 早结束后晚事件回到 lane 0', () => {
        const events = [ev(0, 30), ev(30, 60), ev(31, 45)]
        assignVizLanes(events)
        // 0-30 与 30-60 相邻（不重叠）自成一组 lanes=1；31-45 与 30-60 重叠成链 lanes=2
        expect(events.map((e) => [e.lane, e.lanes])).toEqual([[0, 1], [0, 2], [1, 2]])
    })

    test('空数组安全', () => {
        expect(() => assignVizLanes([])).not.toThrow()
    })
})
