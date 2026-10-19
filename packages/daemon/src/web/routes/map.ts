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
 * 地图设置与静态地图代理（地图组件票 01）。
 *
 * 两条通道：
 * - GET/POST `/api/map`：三档配置读写。JS API key + 安全密钥下发给前端（交互
 *   地图初始化需要）；Web 服务 key 只回「设没设」标记，永不出服务端。
 * - GET `/api/map/static`：静态地图代理。浏览器只带地图参数，daemon 用
 *   `webServiceKey` 拼高德 URL 拉图并缓存——key 不进前端 URL、不受浏览器
 *   跨域/域名白名单限制。
 *
 * 安全边界：上游地址固定（restapi.amap.com），其余参数经 zod 白名单校验后
 * 编码进 query，无 SSRF 面；结果按参数缓存并限制条数。
 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
    MapSettingsSubmissionSchema,
    OVERSEAS_MAX_STATIC_ZOOM,
    isOverseasMapView,
    mapCoordinate,
    mergeMapSettings,
    normalizeHex,
    toMapSettingsView,
} from '@mobi/shared'
import type { WebAppEnv } from '../middleware/auth'
import { getConfiguration } from '../../configuration'
import { readSettings, updateSettingsFile } from '../../config/settings'

/** 高德静态地图服务地址（固定上游，参数只作为 query） */
const STATIC_MAP_URL = 'https://restapi.amap.com/v3/staticmap'
/** 默认标注/线条颜色（高德要求 0xRRGGBB） */
const DEFAULT_MARKER_COLOR = '0xE64340'

const staticMapQuerySchema = z.object({
    center: mapCoordinate.optional(),
    zoom: z.coerce.number().int().min(3).max(18).optional(),
    /** JSON 数组字符串：{position,label?}[] */
    markers: z.string().max(4_000).optional(),
    /** JSON 数组字符串：{points,color?,weight?}[] */
    paths: z.string().max(8_000).optional(),
    height: z.coerce.number().int().min(120).max(600).optional(),
})

const staticMarkersSchema = z.array(z.object({
    position: mapCoordinate,
    label: z.string().max(40).optional(),
})).max(12)

const staticPathsSchema = z.array(z.object({
    // 截断到 200 点（query 串 ≤8KB）而非拒绝：交互档无点数上限，两档不得静默分叉
    points: z.array(mapCoordinate).min(2).transform((pts) => pts.slice(0, 200)),
    color: z.string().max(32).optional(),
    weight: z.number().min(0.5).max(20).optional(),
})).max(3)

/** "#RGB"/"#RRGGBB" → "0xRRGGBB"；无法识别时返回默认色 */
export function toAmapColor(color: string | undefined): string {
    const hex = color === undefined ? null : normalizeHex(color)
    return hex === null ? DEFAULT_MARKER_COLOR : `0x${hex.toUpperCase()}`
}

/**
 * 组装高德静态地图请求 URL（纯函数，便于单测）。
 * 覆盖物格式见高德 Web 服务静态地图文档：
 * markers = style:pos1;pos2，labels = text,font,bold,size,fontColor,bg:pos。
 */
export function buildStaticMapUrl(input: {
    key: string
    center?: string
    zoom?: number
    markers?: Array<{ position: string; label?: string }>
    paths?: Array<{ points: string[]; color?: string; weight?: number }>
    height: number
}): string {
    const params = new URLSearchParams()
    params.set('key', input.key)
    params.set('size', `750*${input.height}`)
    if (input.center) params.set('location', input.center)
    // 高德静态图海外只覆盖到 8 级（9+ 瓦片空白）：代理是与该上游对话的唯一一层，
    // 钳制收口在此——zoom 省略时高德按默认/自适应档出图（>8 级），同样必须钳住
    const overseas = isOverseasMapView(input)
    if (input.zoom !== undefined) {
        params.set('zoom', String(overseas ? Math.min(input.zoom, OVERSEAS_MAX_STATIC_ZOOM) : input.zoom))
    } else if (overseas) {
        params.set('zoom', String(OVERSEAS_MAX_STATIC_ZOOM))
    }

    const markers = input.markers ?? []
    if (markers.length > 0) {
        params.set('markers', `mid,${DEFAULT_MARKER_COLOR},0:${markers.map((m) => m.position).join(';')}`)
        // 文字标签逐个成组：labels style 绑定文字本身，无法合并在一个样式里
        const labelled = markers.filter((m) => m.label?.trim())
        if (labelled.length > 0) {
            params.set(
                'labels',
                labelled
                    .map((m) => `${m.label!.trim()},2,0,13,0xFFFFFF,0x3A3A41:${m.position}`)
                    .join('|'),
            )
        }
    }

    const paths = input.paths ?? []
    if (paths.length > 0) {
        params.set(
            'paths',
            paths
                .map((p) => `${p.weight ?? 4},${toAmapColor(p.color)},1,,:${p.points.join(';')}`)
                .join('|'),
        )
    }

    return `${STATIC_MAP_URL}?${params.toString()}`
}

interface CachedImage {
    body: Uint8Array<ArrayBuffer>
    contentType: string
    at: number
}

/** 静态图缓存：参数 → 图片；上限 60 条、TTL 5 分钟（高德配额按请求计） */
const IMAGE_CACHE_LIMIT = 60
const IMAGE_CACHE_TTL_MS = 5 * 60_000

export interface MapRoutesDeps {
    /** 设置文件路径（测试注入用；缺省走 configuration 单例） */
    getSettingsFile?: () => string
    /** 可注入的 fetch（测试用） */
    fetch?: typeof fetch
}

export function createMapRoutes(deps: MapRoutesDeps = {}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const settingsFileOf = deps.getSettingsFile ?? (() => getConfiguration().settingsFile)
    const fetchImpl = deps.fetch ?? fetch
    const imageCache = new Map<string, CachedImage>()
    const inFlight = new Map<string, Promise<CachedImage | null>>()

    // webServiceKey 短 TTL 内存缓存（含缓存命中路径免一次文件 IO）；POST 保存即失效
    let cachedKey: { at: number; key: string } | null = null
    const KEY_TTL_MS = 30_000
    const readWebServiceKey = async (): Promise<string> => {
        if (cachedKey && Date.now() - cachedKey.at < KEY_TTL_MS) return cachedKey.key
        const settings = await readSettings(settingsFileOf())
        const key = settings?.map?.webServiceKey?.trim() ?? ''
        cachedKey = { at: Date.now(), key }
        return key
    }

    // 脱敏读：webServiceKey 只回 set 标记
    app.get('/map', async (c) => {
        const settings = await readSettings(settingsFileOf())
        return c.json({ settings: toMapSettingsView(settings?.map) })
    })

    app.post('/map', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = MapSettingsSubmissionSchema.safeParse(body)
        if (!parsed.success) {
            const issue = parsed.error.issues[0]
            return c.json({ error: `Invalid map settings (${issue?.path.join('.') ?? 'body'}): ${issue?.message ?? ''}` }, 400)
        }
        const saved = await updateSettingsFile(settingsFileOf(), (current) => ({
            ...current,
            map: mergeMapSettings(current.map, parsed.data),
        }))
        cachedKey = null
        return c.json({ settings: toMapSettingsView(saved.map) })
    })

    app.get('/map/static', async (c) => {
        const parsed = staticMapQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid map query' }, 400)
        }
        const key = await readWebServiceKey()
        if (!key) return c.json({ error: 'map-not-configured' }, 503)

        let markers: z.infer<typeof staticMarkersSchema> | undefined
        let paths: z.infer<typeof staticPathsSchema> | undefined
        try {
            if (parsed.data.markers) markers = staticMarkersSchema.parse(JSON.parse(parsed.data.markers))
            if (parsed.data.paths) paths = staticPathsSchema.parse(JSON.parse(parsed.data.paths))
        } catch {
            return c.json({ error: 'Invalid map overlays' }, 400)
        }

        const url = buildStaticMapUrl({
            key,
            center: parsed.data.center,
            zoom: parsed.data.zoom,
            markers,
            paths,
            height: parsed.data.height ?? 280,
        })
        const cacheKey = url.replace(`key=${encodeURIComponent(key)}`, 'key=__redacted__')

        const cached = imageCache.get(cacheKey)
        if (cached && Date.now() - cached.at < IMAGE_CACHE_TTL_MS) {
            return c.body(cached.body, 200, {
                'Content-Type': cached.contentType,
                'Cache-Control': 'private, max-age=300',
            })
        }

        let pending = inFlight.get(cacheKey)
        if (!pending) {
            pending = (async (): Promise<CachedImage | null> => {
                try {
                    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
                    const contentType = res.headers.get('content-type') ?? ''
                    if (!res.ok || !contentType.startsWith('image/')) return null
                    const body = new Uint8Array(await res.arrayBuffer())
                    const entry: CachedImage = { body, contentType, at: Date.now() }
                    imageCache.set(cacheKey, entry)
                    if (imageCache.size > IMAGE_CACHE_LIMIT) {
                        const oldest = imageCache.keys().next().value
                        if (oldest !== undefined) imageCache.delete(oldest)
                    }
                    return entry
                } catch {
                    return null
                } finally {
                    inFlight.delete(cacheKey)
                }
            })()
            inFlight.set(cacheKey, pending)
        }

        const entry = await pending
        if (!entry) return c.json({ error: 'map-upstream-failed' }, 502)
        return c.body(entry.body, 200, {
            'Content-Type': entry.contentType,
            'Cache-Control': 'private, max-age=300',
        })
    })

    return app
}
