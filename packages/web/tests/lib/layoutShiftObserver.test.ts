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
 * layout-shift 源归因观测器测试（docs/research-claude-ai-perf.md §2.5）
 * 依赖注入 PerformanceObserver / log，不碰真实浏览器 API
 */

import { describe, it, expect, vi } from 'vitest'
import {
    PERF_REGION_ATTR,
    resolveRegionName,
    startLayoutShiftObserver,
    type LayoutShiftEntryLike,
    type LongTaskEntryLike,
} from '@/core/lib/layoutShiftObserver'

function buildDom() {
    const chat = document.createElement('div')
    chat.setAttribute(PERF_REGION_ATTR, 'chat')
    const bubble = document.createElement('div')
    const text = document.createElement('span')
    bubble.appendChild(text)
    chat.appendChild(bubble)
    document.body.appendChild(chat)
    return { chat, bubble, text }
}

describe('resolveRegionName', () => {
    it('从 source 元素向上找到最近的命名区域祖先', () => {
        const { bubble } = buildDom()
        expect(resolveRegionName(bubble)).toBe('chat')
    })

    it('区域内层深元素同样归因到该区域（内层优先）', () => {
        const { text } = buildDom()
        expect(resolveRegionName(text)).toBe('chat')
    })

    it('source 是文本节点时经 parentNode 归因', () => {
        const { chat } = buildDom()
        const textNode = document.createTextNode('hi')
        chat.appendChild(textNode)
        expect(resolveRegionName(textNode)).toBe('chat')
    })

    it('无标注祖先与 null source 落 unknown', () => {
        buildDom()
        const orphan = document.createElement('div')
        document.body.appendChild(orphan)
        expect(resolveRegionName(orphan)).toBe('unknown')
        expect(resolveRegionName(null)).toBe('unknown')
    })
})

describe('startLayoutShiftObserver', () => {
    class FakePerformanceObserver {
        static instances: FakePerformanceObserver[] = []
        callback: (list: { getEntries: () => PerfEntryLike[] }) => void
        observedTypes: string[] = []
        disconnected = false

        constructor(callback: (list: { getEntries: () => PerfEntryLike[] }) => void) {
            this.callback = callback
            FakePerformanceObserver.instances.push(this)
        }

        observe(options: { type: string; buffered?: boolean }) {
            this.observedTypes.push(options.type)
        }

        disconnect() {
            this.disconnected = true
        }
    }

    function makeEntry(overrides: Partial<LayoutShiftEntryLike> = {}): LayoutShiftEntryLike {
        const chat = document.createElement('div')
        chat.setAttribute(PERF_REGION_ATTR, 'chat')
        document.body.appendChild(chat)
        return {
            startTime: 1234,
            value: 0.05,
            sources: [{ node: chat }],
            ...overrides,
        }
    }

    it('以 buffered 同时观测 layout-shift 与 longtask', () => {
        FakePerformanceObserver.instances = []
        const stop = startLayoutShiftObserver({ PerformanceObserver: FakePerformanceObserver })
        const observer = FakePerformanceObserver.instances[0]
        expect(observer.observedTypes).toContain('layout-shift')
        expect(observer.observedTypes).toContain('longtask')
        stop()
        expect(observer.disconnected).toBe(true)
    })

    it('longtask entry 进环形缓冲且不触发 console 输出', () => {
        FakePerformanceObserver.instances = []
        const log = vi.fn()
        const stop = startLayoutShiftObserver({ PerformanceObserver: FakePerformanceObserver, log })
        const longtask: LongTaskEntryLike = { entryType: 'longtask', startTime: 5000, duration: 87 }
        FakePerformanceObserver.instances[0].callback({ getEntries: () => [longtask] })

        expect(log).not.toHaveBeenCalled()
        const tasks = window.__mobiPerf?.getLongtasks() ?? []
        expect(tasks).toHaveLength(1)
        expect(tasks[0]).toEqual({ startTime: 5000, duration: 87 })
        stop()
    })

    it('entry sources 归因到命名区域并输出日志', () => {
        FakePerformanceObserver.instances = []
        const log = vi.fn()
        const composer = document.createElement('div')
        composer.setAttribute(PERF_REGION_ATTR, 'composer')
        document.body.appendChild(composer)

        const stop = startLayoutShiftObserver({
            PerformanceObserver: FakePerformanceObserver,
            log,
        })
        const entry = makeEntry({
            value: 0.05,
            sources: [{ node: document.querySelector(`[${PERF_REGION_ATTR}="chat"]`)! }, { node: composer }],
        })
        FakePerformanceObserver.instances[0].callback({ getEntries: () => [entry] })

        expect(log).toHaveBeenCalledTimes(1)
        const message = log.mock.calls[0][0] as string
        expect(message).toContain('chat')
        expect(message).toContain('composer')
        expect(message).toContain('0.05')
        stop()
    })

    it('同一 entry 多个 source 同区域时去重', () => {
        FakePerformanceObserver.instances = []
        const log = vi.fn()
        const stop = startLayoutShiftObserver({
            PerformanceObserver: FakePerformanceObserver,
            log,
        })
        const node = document.querySelector(`[${PERF_REGION_ATTR}="chat"]`)!
        const entry = makeEntry({ sources: [{ node }, { node }] })
        FakePerformanceObserver.instances[0].callback({ getEntries: () => [entry] })

        const message = log.mock.calls[0][0] as string
        expect(message.match(/chat/g)).toHaveLength(1)
        stop()
    })

    it('环形缓冲可经 getShifts 回读（真机排查通道）', () => {
        FakePerformanceObserver.instances = []
        const stop = startLayoutShiftObserver({
            PerformanceObserver: FakePerformanceObserver,
            log: vi.fn(),
        })
        const entry = makeEntry({ value: 0.07 })
        FakePerformanceObserver.instances[0].callback({ getEntries: () => [entry] })

        const shifts = window.__mobiPerf?.getShifts() ?? []
        expect(shifts).toHaveLength(1)
        expect(shifts[0]).toMatchObject({ value: 0.07, startTime: 1234, regions: ['chat'] })
        stop()
    })

    it('环境无 PerformanceObserver 时安全空转', () => {
        const stop = startLayoutShiftObserver({ PerformanceObserver: undefined })
        expect(() => stop()).not.toThrow()
    })
})
