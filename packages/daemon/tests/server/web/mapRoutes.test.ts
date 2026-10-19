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

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebAppEnv } from '../../../src/web/middleware/auth'
import { buildStaticMapUrl, createMapRoutes, toAmapColor } from '../../../src/web/routes/map'

/**
 * 地图路由（地图组件票 01）：设置三档推导 + 静态图代理。
 * deps 注入临时 settingsFile 与 fetch 探针，不碰真实 MOBI_HOME/高德网络。
 */

let dataDir: string
let settingsFile: string

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mobi-map-routes-'))
    settingsFile = join(dataDir, 'settings.daemon.json')
})

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
})

function makeApp(fetchImpl?: typeof fetch) {
    const app = new Hono<WebAppEnv>()
    app.route('/api', createMapRoutes({ getSettingsFile: () => settingsFile, fetch: fetchImpl }))
    return app
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/** 记录调用的假 fetch：返回 1x1 PNG 头 */
function pngFetch(calls: string[]): typeof fetch {
    const impl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
        calls.push(String(input))
        return new Response(PNG, { headers: { 'content-type': 'image/png' } })
    }
    return impl as unknown as typeof fetch
}

describe('地图设置（GET/POST /api/map）', () => {
    it('未配置 → mode none；webServiceKey 只回 set 标记', async () => {
        const res = await makeApp().request('/api/map')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            settings: { mode: 'none', webServiceKeySet: false },
        })
    })

    it('三档推导：只有服务端 key → static；JS key+安全密钥齐备 → interactive', async () => {
        let res = await makeApp().request('/api/map', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ webServiceKey: 'ws-key' }),
        })
        expect(((await res.json()) as { settings: { mode: string; webServiceKeySet: boolean } }).settings)
            .toEqual({ mode: 'static', webServiceKeySet: true })

        res = await makeApp().request('/api/map', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsApiKey: 'js-key', securityJsCode: 'sec' }),
        })
        expect(await res.json()).toEqual({
            settings: { mode: 'interactive', jsApiKey: 'js-key', securityJsCode: 'sec', webServiceKeySet: true },
        })

        // 空串清除：JS key 清除后回落到 static
        res = await makeApp().request('/api/map', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsApiKey: '', securityJsCode: '' }),
        })
        expect(await res.json()).toEqual({ settings: { mode: 'static', webServiceKeySet: true } })
    })
})

describe('静态地图代理（GET /api/map/static）', () => {
    it('未配置 webServiceKey → 503', async () => {
        const res = await makeApp().request('/api/map/static?center=116.39,39.9&zoom=12')
        expect(res.status).toBe(503)
    })

    it('拼高德参数并返回图片；相同参数第二次命中缓存', async () => {
        await Bun.write(settingsFile, JSON.stringify({ map: { webServiceKey: 'ws-key' } }))
        const calls: string[] = []
        const app = makeApp(pngFetch(calls))
        const query = new URLSearchParams({
            center: '116.39,39.9',
            zoom: '12',
            height: '320',
            markers: JSON.stringify([{ position: '116.39,39.9', label: '公司' }]),
            paths: JSON.stringify([{ points: ['116.39,39.9', '116.40,39.91'], color: '#ff6600', weight: 5 }]),
        })

        const res = await app.request(`/api/map/static?${query.toString()}`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/png')
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)

        expect(calls).toHaveLength(1)
        const url = new URL(calls[0])
        expect(url.origin + url.pathname).toBe('https://restapi.amap.com/v3/staticmap')
        expect(url.searchParams.get('key')).toBe('ws-key')
        expect(url.searchParams.get('location')).toBe('116.39,39.9')
        expect(url.searchParams.get('zoom')).toBe('12')
        expect(url.searchParams.get('size')).toBe('750*320')
        expect(url.searchParams.get('markers')).toBe('mid,0xE64340,0:116.39,39.9')
        expect(url.searchParams.get('labels')).toBe('公司,2,0,13,0xFFFFFF,0x3A3A41:116.39,39.9')
        expect(url.searchParams.get('paths')).toBe('5,0xFF6600,1,,:116.39,39.9;116.40,39.91')

        await app.request(`/api/map/static?${query.toString()}`)
        expect(calls).toHaveLength(1)
    })

    it('上游非图片 / 网络失败 → 502', async () => {
        await Bun.write(settingsFile, JSON.stringify({ map: { webServiceKey: 'ws-key' } }))
        const badFetch = (async () => new Response('boom', { status: 200, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch
        const res = await makeApp(badFetch).request('/api/map/static?center=116.39,39.9&zoom=12')
        expect(res.status).toBe(502)
    })

    it('覆盖物 JSON 非法 → 400', async () => {
        await Bun.write(settingsFile, JSON.stringify({ map: { webServiceKey: 'ws-key' } }))
        const query = new URLSearchParams({ markers: 'not-json' })
        const res = await makeApp().request(`/api/map/static?${query.toString()}`)
        expect(res.status).toBe(400)
    })
})

describe('纯函数', () => {
    it('toAmapColor：#RGB 展开、#RRGGBB 大写、非法回默认', () => {
        expect(toAmapColor('#f60')).toBe('0xFF6600')
        expect(toAmapColor('#ff6600')).toBe('0xFF6600')
        expect(toAmapColor('red')).toBe('0xE64340')
        expect(toAmapColor(undefined)).toBe('0xE64340')
    })

    it('buildStaticMapUrl：无覆盖物时不带 markers/labels/paths', () => {
        const url = new URL(buildStaticMapUrl({ key: 'k', height: 200 }))
        expect(url.searchParams.get('size')).toBe('750*200')
        expect(url.searchParams.has('markers')).toBe(false)
        expect(url.searchParams.has('labels')).toBe(false)
        expect(url.searchParams.has('paths')).toBe(false)
    })

    // 高德静态图海外 9 级起瓦片空白：钳制收口在代理层（与上游对话的唯一一层）
    it('buildStaticMapUrl：海外视野 zoom 钳到 8，国内视野透传', () => {
        const overseas = buildStaticMapUrl({ key: 'k', height: 200, zoom: 13, markers: [{ position: '-122.4187,37.8021' }] })
        expect(new URL(overseas).searchParams.get('zoom')).toBe('8')

        const domestic = buildStaticMapUrl({ key: 'k', height: 200, zoom: 13, center: '116.39,39.9' })
        expect(new URL(domestic).searchParams.get('zoom')).toBe('13')
    })
})
