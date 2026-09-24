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
 * dev-only layout-shift 源归因观测器（docs/research-claude-ai-perf.md §2.5）
 *
 * CLS 总分测不出「阈值内的体感位移」（文章实证：单次 0.008 远低于 0.1 阈值，
 * 但 31% 的页面加载在可用后仍有无交互位移）。这里直接消费 Layout Instability API
 * 的 entry.sources，把位移源归因到命名区域（data-perf-region 标注），逐条输出：
 * - console：开发时直接看
 * - window.__mobiPerf.getShifts()：环形缓冲，移动端 PWA 真机上 console 不便回读，
 *   模式参照 core/lib/diag.ts 的 window.__mobiDiag
 *
 * 仅在 DEV 启动（startLayoutShiftObserver 内部闸），生产构建零开销。
 * 区域标注是渐进约定：没有 data-perf-region 祖先的位移源落 'unknown'，不报错。
 */

/** 区域标注属性名，布局根元素加 `data-perf-region="sidebar|chat|composer|drawer"` */
export const PERF_REGION_ATTR = 'data-perf-region'

/** 观测器可消费的最小 entry 形状（与 DOM LayoutShift 结构对齐，便于测试注入） */
export interface LayoutShiftEntryLike {
    startTime: number
    value: number
    sources: { node: Node | null }[]
}

/** 归因结果 */
export interface ShiftRecord {
    startTime: number
    value: number
    /** 去重后的区域名（sidebar/chat/composer/drawer/…/unknown） */
    regions: string[]
}

/** 真机排查通道：环形缓冲最近 N 条位移记录 */
export interface MobiPerf {
    getShifts: () => ShiftRecord[]
}

declare global {
    interface Window {
        __mobiPerf?: MobiPerf
    }
}

const SHIFT_BUFFER_SIZE = 50

/**
 * 从 source 节点向上找最近的 data-perf-region 祖先（内层优先：composer 标注在
 * chat 区域内部时，composer 内的位移源归 composer）。文本节点经 parentNode 归因。
 */
export function resolveRegionName(node: Node | null, root: ParentNode = document): string {
    let current: Node | null = node
    while (current && current !== root) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const region = (current as Element).getAttribute?.(PERF_REGION_ATTR)
            if (region) return region
        }
        current = current.parentNode
    }
    return 'unknown'
}

export interface StartLayoutShiftObserverOptions {
    /** 注入点：默认 globalThis.PerformanceObserver（jsdom 无此 API，测试注入桩） */
    PerformanceObserver?: LayoutShiftObserverCtor
    /** 注入点：默认 console.warn */
    log?: (message: string) => void
}

/** 观测器注入的最小构造器形状（与 DOM PerformanceObserver 对齐子集） */
type LayoutShiftObserverCtor = new (callback: (list: { getEntries: () => LayoutShiftEntryLike[] }) => void) => {
    observe: (options: { type: string; buffered?: boolean }) => void
    disconnect: () => void
}

/**
 * 启动观测，返回停止函数。非 DEV 环境（生产构建）直接空转——观测器是开发期
 * 取证设施，不进生产路径（自托管产品不做线上遥测）。
 */
export function startLayoutShiftObserver(options: StartLayoutShiftObserverOptions = {}): () => void {
    if (!import.meta.env.DEV) return () => {}

    const PerformanceObserverCtor = options.PerformanceObserver
        ?? (globalThis.PerformanceObserver as unknown as LayoutShiftObserverCtor | undefined)
    if (typeof PerformanceObserverCtor !== 'function') return () => {}
    const log = options.log ?? ((message: string) => console.warn(message))

    const buffer: ShiftRecord[] = []
    window.__mobiPerf = {
        getShifts: () => [...buffer],
    }

    const observer = new PerformanceObserverCtor((list) => {
        for (const entry of list.getEntries()) {
            // unknown 保留：它说明出现了未标注区域的位移源，本身就是待标注的线索
            const regions = [...new Set(entry.sources.map(source => resolveRegionName(source.node)))]
            const record: ShiftRecord = { startTime: entry.startTime, value: entry.value, regions }
            buffer.push(record)
            if (buffer.length > SHIFT_BUFFER_SIZE) buffer.shift()
            log(`[mobi-perf] layout shift ${entry.value.toFixed(4)} @ ${Math.round(entry.startTime)}ms → ${regions.join(', ')}`)
        }
    })
    // buffered: true 补读观测器挂载前（首绘附近）的位移——那正是静态内容回填的高发段
    observer.observe({ type: 'layout-shift', buffered: true })

    return () => observer.disconnect()
}
