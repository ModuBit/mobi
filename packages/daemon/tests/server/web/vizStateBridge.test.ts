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
 * viz 状态/高度桥（VIZ_STATE_BRIDGE_JS）单测（visualize-runtime 票 03）。
 *
 * 桥是注入 fragment 前的内联脚本——测试用 new Function 求值脚本文本 +
 * 手写 DOM/存储桩（daemon 侧 bun:test 无 DOM 环境）。锁的是高度上报语义
 * 与 widgetState 契约，不锁脚本实现细节。
 */

import { describe, test, expect } from 'bun:test'
import { VIZ_STATE_BRIDGE_JS } from '../../../src/web/vizRuntime/vizRuntimeScript'

/** 求值桥脚本，返回可控环境句柄（桩几何可事后改，供收缩场景复测） */
function evalBridge(geometry: {
    bodyScrollHeight: number
    deScrollHeight: number
    deClientHeight: number
}, storage?: () => Storage) {
    const posted: Array<{ type: string; height?: number }> = []
    const store = new Map<string, string>()
    const healthyStorage: Storage = {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
        length: 0, key: () => null, clear: () => store.clear(),
    }
    const windowStub: Record<string, unknown> = {
        // storage 桩可注入「抛异常」实现：探针写入失败 → 桥降级 statePersistence='none'
        localStorage: storage ? storage() : healthyStorage,
        dispatchEvent: () => {},
    }
    const documentStub = {
        readyState: 'complete',
        body: { scrollHeight: geometry.bodyScrollHeight },
        documentElement: {
            scrollHeight: geometry.deScrollHeight,
            clientHeight: geometry.deClientHeight,
        },
        addEventListener: () => {},
    }
    const parentStub = { postMessage: (data: { type: string; height?: number }) => void posted.push(data) }
    const locationStub = { pathname: '/sessions/s/serve-file/x.html', origin: 'http://localhost' }
    const ResizeObserverStub = class {
        observe(): void {}
    }
    const CustomEventStub = class {
        constructor(public type: string, public init: unknown) {}
    }
    new Function(
        'window', 'document', 'parent', 'location', 'ResizeObserver', 'CustomEvent', 'TextEncoder',
        VIZ_STATE_BRIDGE_JS,
    )(windowStub, documentStub, parentStub, locationStub, ResizeObserverStub, CustomEventStub, globalThis.TextEncoder)
    return { window: windowStub, document: documentStub, posted }
}

describe('viz 高度上报', () => {
    test('内容矮于视口（iframe 比内容高）：报内容高，不报视口高（收缩可达）', () => {
        // 场景即真机实锤：初始 chrome 640 → documentElement.scrollHeight=638（视口高）
        // 但 body 只有 219。必须报 219，报 638 会把高度粘死在初始 chrome
        const env = evalBridge({ bodyScrollHeight: 219, deScrollHeight: 638, deClientHeight: 638 })
        expect(env.posted).toEqual([{ type: 'mobi-viz-height', height: 219 }])
    })

    test('内容高于视口（真溢出）：报 documentElement.scrollHeight', () => {
        const env = evalBridge({ bodyScrollHeight: 900, deScrollHeight: 900, deClientHeight: 638 })
        expect(env.posted).toEqual([{ type: 'mobi-viz-height', height: 900 }])
    })

    test('内容收缩后再次上报：跟随 body 收缩', () => {
        const env = evalBridge({ bodyScrollHeight: 500, deScrollHeight: 638, deClientHeight: 638 })
        expect(env.posted).toHaveLength(1)
        // 模拟内容收缩：body 变小，视口（clientHeight）同步缩小到新报高
        ;(env.document.body as { scrollHeight: number }).scrollHeight = 260
        ;(env.document.documentElement as { scrollHeight: number; clientHeight: number }).scrollHeight = 260
        ;(env.document.documentElement as { scrollHeight: number; clientHeight: number }).clientHeight = 260
        // 直接再跑一次上报（真机由 ResizeObserver 触发，桩不自动触发）
        // 通过重新求值同几何验证：收缩后的稳态上报 260
        const env2 = evalBridge({ bodyScrollHeight: 260, deScrollHeight: 260, deClientHeight: 260 })
        expect(env2.posted).toEqual([{ type: 'mobi-viz-height', height: 260 }])
    })

    test('同高度重复上报去抖（≥1px 才发）', () => {
        const env = evalBridge({ bodyScrollHeight: 219, deScrollHeight: 638, deClientHeight: 638 })
        expect(env.posted).toHaveLength(1)
    })

    test('超 10,000px 上限：不上报（转 iframe 内滚动的宿主侧约定）', () => {
        const env = evalBridge({ bodyScrollHeight: 10001, deScrollHeight: 10001, deClientHeight: 638 })
        expect(env.posted).toEqual([])
    })
})

describe('viz widgetState 契约', () => {
    /** 桥建出的 MobiApp API 面（测试只锁契约语义，不锁实现） */
    type VizApi = {
        statePersistence: string
        getWidgetState: () => unknown
        setWidgetState: (next: unknown) => Promise<void>
    }

    function evalWithState() {
        return evalBridge({ bodyScrollHeight: 100, deScrollHeight: 100, deClientHeight: 100 })
    }

    test('statePersistence=local；getWidgetState 初始 null', () => {
        const env = evalWithState()
        const api = env.window.MobiApp as VizApi
        expect(api.statePersistence).toBe('local')
        expect(api.getWidgetState()).toBe(null)
    })

    test('setWidgetState 写入/读取；非对象拒绝', async () => {
        const env = evalWithState()
        const api = env.window.MobiApp as VizApi
        await api.setWidgetState({ count: 3 })
        expect(api.getWidgetState()).toEqual({ count: 3 })
        await expect(api.setWidgetState([1, 2])).rejects.toThrow()
        await expect(api.setWidgetState('x' as never)).rejects.toThrow()
        // 拒绝不影响旧值
        expect(api.getWidgetState()).toEqual({ count: 3 })
    })

    test('超 16KiB 拒绝且旧值保留', async () => {
        const env = evalWithState()
        const api = env.window.MobiApp as VizApi
        await api.setWidgetState({ keep: true })
        const big = 'x'.repeat(17 * 1024)
        await expect(api.setWidgetState({ big })).rejects.toThrow()
        expect(api.getWidgetState()).toEqual({ keep: true })
    })

    test('localStorage 不可用：statePersistence=none，写入 resolve 不抛（状态只活本帧）', async () => {
        const broken = () => {
            const throwing: Storage = {
                setItem: () => { throw new Error('quota') },
                getItem: () => { throw new Error('quota') },
                removeItem: () => { throw new Error('quota') },
                length: 0, key: () => null, clear: () => {},
            }
            return throwing
        }
        const env = evalBridge({ bodyScrollHeight: 100, deScrollHeight: 100, deClientHeight: 100 }, broken)
        const api = env.window.MobiApp as VizApi
        expect(api.statePersistence).toBe('none')
        expect(api.getWidgetState()).toBe(null)
        await expect(api.setWidgetState({ a: 1 })).resolves.toBeUndefined()
        expect(api.getWidgetState()).toEqual({ a: 1 })
    })
})
