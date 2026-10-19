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
 * Map 组件三档渲染（地图组件票 02），seam 与 Chart/Svg 相同：直接渲染
 * OpenUIRenderer（生产同一条 mobiLibrary 装配），配置读取用模块级 fetch 桩。
 *
 * - none：块内出「未配置高德地图 key」+ uri.amap.com 链接；
 * - static：<img> 指向 /api/map/static 代理（key 不出现在 src）；
 * - interactive：高德 loader 被调用（key/安全密钥正确），覆盖物挂到地图实例。
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { MapSettingsView } from '@mobi/shared'

import { streamingDisplayState } from '../helpers/streamingContentMock'
vi.mock('@/ui/shared/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const amap = vi.hoisted(() => {
    const constructed: Array<{ kind: string; options: unknown }> = []
    const mapInstance = {
        add: vi.fn(),
        setFitView: vi.fn(),
        setMapStyle: vi.fn(),
        destroy: vi.fn(),
    }
    class FakeMap {
        constructor(_el: HTMLElement, options: unknown) {
            constructed.push({ kind: 'Map', options })
        }
        add = mapInstance.add
        setFitView = mapInstance.setFitView
        setMapStyle = mapInstance.setMapStyle
        destroy = mapInstance.destroy
    }
    class FakeMarker {
        constructor(options: unknown) { constructed.push({ kind: 'Marker', options }) }
    }
    class FakePolyline {
        constructor(options: unknown) { constructed.push({ kind: 'Polyline', options }) }
    }
    return {
        constructed,
        mapInstance,
        load: vi.fn(async () => ({ Map: FakeMap, Marker: FakeMarker, Polyline: FakePolyline })),
    }
})

vi.mock('@amap/amap-jsapi-loader', () => ({ load: amap.load }))

const OpenUIRenderer = (await import('@/ui/openui/OpenUIRenderer')).default
const { invalidateMapSettingsCache } = await import('@/core/data/mapSettingsCache')

const CODE = `root = Stack([map])
map = Map("116.39,39.9", 12, [{"position": "116.39,39.9", "label": "公司"}], [{"points": ["116.39,39.9", "116.40,39.91"], "color": "#ff6600", "weight": 5}])`

function stubSettings(view: MapSettingsView | null) {
    const fetchMock = vi.fn(async () => ({
        ok: view !== null,
        json: async () => (view === null ? {} : { settings: view }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

function renderMap() {
    streamingDisplayState.current = CODE
    return render(<OpenUIRenderer code={CODE} streaming={false} />)
}

beforeEach(() => {
    invalidateMapSettingsCache()
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    amap.constructed.length = 0
    amap.load.mockClear()
    amap.mapInstance.add.mockClear()
    amap.mapInstance.setFitView.mockClear()
    amap.mapInstance.destroy.mockClear()
})

describe('Map 组件三档渲染', () => {
    it('none：出未配置提示与高德 URI 链接', async () => {
        stubSettings({ mode: 'none', webServiceKeySet: false })
        renderMap()
        expect(await screen.findByText('未配置高德地图 key')).toBeInTheDocument()
        const link = screen.getByText('在高德地图中打开') as HTMLAnchorElement
        expect(link.href).toContain('https://uri.amap.com/marker?position=116.39%2C39.9')
        expect(link.href).toContain('name=%E5%85%AC%E5%8F%B8')
    })

    it('static：<img> 指向 daemon 代理，key 不出现在 src', async () => {
        stubSettings({ mode: 'static', webServiceKeySet: true })
        const { container } = renderMap()
        await waitFor(() => expect(container.querySelector('[data-mobi-map="static"]')).not.toBeNull())
        const img = container.querySelector('[data-mobi-map="static"]') as HTMLImageElement
        expect(img.getAttribute('src')).toContain('/api/map/static?')
        expect(img.getAttribute('src')).not.toContain('key=')
        expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain('"position":"116.39,39.9"')
        // jsdom 不加载图片：加载中提示保留，证明底纹上不是空白
        expect(screen.getByText('地图加载中…')).toBeInTheDocument()
    })

    it('interactive：loader 收到 key，安全密钥在加载前设置，覆盖物挂到地图', async () => {
        stubSettings({ mode: 'interactive', jsApiKey: 'js-key', securityJsCode: 'sec', webServiceKeySet: true })
        const { container } = renderMap()
        await waitFor(() => expect(container.querySelector('[data-mobi-map="interactive"]')).not.toBeNull())

        expect((window as { _AMapSecurityConfig?: { securityJsCode?: string } })._AMapSecurityConfig?.securityJsCode).toBe('sec')
        expect(amap.load).toHaveBeenCalledWith({ key: 'js-key', version: '2.0' })

        await waitFor(() => {
            const mapCall = amap.constructed.find((c) => c.kind === 'Map')
            expect(mapCall).toBeDefined()
            expect((mapCall?.options as { zoom?: number }).zoom).toBe(12)
        })
        expect(amap.constructed.filter((c) => c.kind === 'Marker')).toHaveLength(1)
        expect(amap.constructed.filter((c) => c.kind === 'Polyline')).toHaveLength(1)
        await waitFor(() => expect(amap.mapInstance.add).toHaveBeenCalled())
        // 显式 zoom 时不得用 fitView 顶掉调用方视野（单 marker 会被顶到 17+ 级）
        expect(amap.mapInstance.setFitView).not.toHaveBeenCalled()
    })
})
