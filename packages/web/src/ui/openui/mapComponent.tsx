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
 * Map 组件实现（高德地图）。签名在 shared（`mapComponentSpec`），三档渲染由
 * daemon 设置决定：
 *
 * - interactive：配置了 JS API key + 安全密钥 → 加载高德 JS API 2.0（WebGL），
 *   支持平移缩放与覆盖物；
 * - static：只有 Web 服务 key → `<img>` 指向 daemon 的 /api/map/static 代理，
 *   key 不出服务端；
 * - none：都没配 → 降级为高德 URI 链接卡（`uri.amap.com`，无需 key）。
 *
 * 配置读取走 `loadMapSettings`（模块级缓存）而非 react-query：openui 渲染器
 * chunk 不保证外层有 QueryClient（预览/测试裸渲染）。
 */

import { defineComponent, useIsStreaming, type ComponentRenderProps } from '@openuidev/react-lang'
import { isOverseasMapView, mapComponentSpec, type MapProps, type MapSettingsView } from '@mobi/shared'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { loadMapSettings } from '@/core/data/mapSettingsCache'
import { useColorScheme } from '@/ui/base/theme/useColorScheme'

const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 140
const MAX_HEIGHT = 520

/**
 * 高德海外底图覆盖不足：9 级以上瓦片为空，画布整块空白（2026-10-19 实测旧金山
 * z=10+ 全白、z=8 只有海岸线）。因此交互地图的海外视野换用第三方栅格瓦片
 * （Esri World Street Map，AMap.TileLayer 自定义 tileUrl 加载）；静态图的 zoom
 * 钳制收口在 daemon 代理（`buildStaticMapUrl`，与该上游对话的唯一一层）。
 */

/** 海外交互地图栅格瓦片（Esri ArcGIS Online；亮/暗两套） */
const OVERSEAS_TILE_URL = {
    light: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/[z]/[y]/[x]',
    dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/[z]/[y]/[x]',
} as const

type Coordinate = [number, number]

/** 高德 JS API 的最小类型面（只声明本组件用到的构造器/方法） */
interface AMapMapInstance {
    add(overlays: unknown[]): void
    setFitView(): void
    setMapStyle(style: string): void
    destroy(): void
}

interface AMapNamespace {
    Map: new (container: HTMLElement, options: {
        zoom?: number
        center?: Coordinate
        viewMode?: '2D' | '3D'
        mapStyle?: string
        /** 显式图层列表：海外视野只挂第三方栅格瓦片，不叠高德空底图 */
        layers?: unknown[]
    }) => AMapMapInstance
    /** 自定义栅格瓦片（tileUrl 支持 [x]/[y]/[z] 占位符） */
    TileLayer: new (options: { tileUrl: string; zIndex?: number }) => unknown
    Marker: new (options: { position: Coordinate; title?: string; content?: HTMLElement }) => unknown
    Polyline: new (options: {
        path: Coordinate[]
        strokeColor?: string
        strokeWeight?: number
        lineJoin?: string
        lineCap?: string
    }) => unknown
}

declare global {
    interface Window {
        _AMapSecurityConfig?: { securityJsCode?: string }
    }
}

function parseCoordinate(value: string): Coordinate {
    const [lng, lat] = value.split(',').map(Number)
    return [lng, lat]
}

function clampHeight(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_HEIGHT
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value)))
}

/** 静态图代理 URL（daemon 拼高德参数并缓存、钳海外 zoom；key 不在此出现） */
export function buildStaticMapSrc(props: MapProps): string {
    const params = new URLSearchParams()
    if (props.center) params.set('center', props.center)
    if (props.zoom !== undefined) params.set('zoom', String(props.zoom))
    if (props.markers?.length) params.set('markers', JSON.stringify(props.markers))
    if (props.paths?.length) params.set('paths', JSON.stringify(props.paths))
    params.set('height', String(clampHeight(props.height)))
    return `/api/map/static?${params.toString()}`
}

/** 高德 URI API 链接（无需 key）：有标注用标注点，否则用中心点/首个折线点 */
export function buildMapLink(props: MapProps): string | null {
    const first = props.markers?.[0]
    const point = first?.position ?? props.center ?? props.paths?.[0]?.points[0]
    if (!point) return null
    const name = first?.label?.trim() || '地图位置'
    return `https://uri.amap.com/marker?position=${encodeURIComponent(point)}&name=${encodeURIComponent(name)}`
}

const boxStyle = (height: number): CSSProperties => ({
    position: 'relative',
    height,
    // 助手气泡是 shrink-to-fit：子元素 width:100% 对固有宽度贡献为 0，整块会塌成 2px。
    // 给地图一个最小固有宽度，保证只输出 Map 的回复也能撑开气泡。
    width: '100%',
    minWidth: 280,
    borderRadius: 'var(--radius-control-sm)',
    overflow: 'hidden',
    // 底纹：图片/瓦片未就绪时不留纯色空白（rgba 双档通用，不依赖主题变量）
    background: 'var(--iui-surface, #f5f5f5)',
    backgroundImage:
        'linear-gradient(rgba(127, 127, 127, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(127, 127, 127, 0.08) 1px, transparent 1px)',
    backgroundSize: '28px 28px, 28px 28px',
    border: '1px solid var(--iui-border, #e5e5e5)',
})

/** 海外底图使用 Esri 瓦片，需在角落保留来源标注 */
const attributionStyle: CSSProperties = {
    position: 'absolute',
    right: 6,
    bottom: 4,
    padding: '1px 5px',
    borderRadius: 'var(--radius-square)',
    background: 'rgba(255, 255, 255, 0.72)',
    color: '#4a4a4a',
    fontSize: 10,
    lineHeight: 1.4,
    pointerEvents: 'none',
}

const fallbackStyle: CSSProperties = {    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
    textAlign: 'center',
    color: 'var(--iui-muted, #666)',
    fontSize: 13,
}

const linkStyle: CSSProperties = {
    color: 'var(--iui-info, #1677ff)',
    textDecoration: 'none',
    fontSize: 13,
}

function MapFallback({ props, reason }: { props: MapProps; reason: string }) {
    const link = buildMapLink(props)
    return (
        <div style={fallbackStyle}>
            <span>{reason}</span>
            {link ? (
                <a href={link} target="_blank" rel="noreferrer noopener" style={linkStyle}>在高德地图中打开</a>
            ) : (
                <span>缺少地点坐标</span>
            )}
        </div>
    )
}

/** 有 label 的标注画成可见胶囊（数字/短名），否则高德只有 hover 才显示 title */
function createMarkerContent(label: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'mobi-map-pin'
    el.textContent = label
    return el
}

const loadingStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    fontSize: 12,
    color: 'var(--iui-muted, #666)',
}

function StaticMap({ props }: { props: MapProps }) {
    const [failed, setFailed] = useState(false)
    const [loaded, setLoaded] = useState(false)
    if (failed) return <MapFallback props={props} reason="地图图片加载失败" />
    return (
        <>
            {!loaded ? <div style={loadingStyle}>地图加载中…</div> : null}
            <img
                src={buildStaticMapSrc(props)}
                alt={props.markers?.[0]?.label ?? '地图'}
                data-mobi-map="static"
                style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
            />
        </>
    )
}

function InteractiveMap({ props, view, height }: { props: MapProps; view: MapSettingsView; height: number }) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<AMapMapInstance | null>(null)
    const [failed, setFailed] = useState(false)
    const scheme = useColorScheme(container)
    const overseas = isOverseasMapView(props)
    // props 每次渲染是新对象：用签名做 effect 依赖，避免地图反复销毁重建。
    // 海外视图的底图颜色由图层 URL 决定（setMapStyle 管不到自定义图层），
    // 主题切换需重建，故 scheme 一并入签名
    const signature = JSON.stringify([props, view.jsApiKey, view.securityJsCode, overseas ? scheme : null])

    // 签名变化 = 重新初始化：清掉上一次的失败态，允许重试
    useEffect(() => {
        setFailed(false)
    }, [signature])

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                const { jsApiKey, securityJsCode } = view
                // deriveMapMode 保证 interactive 档两者皆非空（类型收敛，非运行时分支）
                if (!jsApiKey || !securityJsCode) return
                // 安全密钥必须在 JS API 脚本加载前设置（高德明文模式）
                window._AMapSecurityConfig = { securityJsCode }
                const { load } = await import('@amap/amap-jsapi-loader')
                const AMap = (await load({ key: jsApiKey, version: '2.0' })) as unknown as AMapNamespace
                if (cancelled || !container.current) return

                const center = props.center ? parseCoordinate(props.center) : undefined
                const map = new AMap.Map(container.current, {
                    zoom: props.zoom ?? 12,
                    ...(center ? { center } : {}),
                    viewMode: '2D',
                    // 海外视野：只挂第三方栅格瓦片（不叠高德空底图）；国内照旧用官方底图
                    ...(overseas
                        ? { layers: [new AMap.TileLayer({ tileUrl: OVERSEAS_TILE_URL[scheme], zIndex: 2 })] }
                        : { mapStyle: scheme === 'dark' ? 'amap://styles/dark' : 'amap://styles/normal' }),
                })
                mapRef.current = map

                const overlays: unknown[] = []
                for (const marker of props.markers ?? []) {
                    overlays.push(new AMap.Marker({
                        position: parseCoordinate(marker.position),
                        ...(marker.label
                            ? { title: marker.label, content: createMarkerContent(marker.label) }
                            : {}),
                    }))
                }
                for (const path of props.paths ?? []) {
                    overlays.push(new AMap.Polyline({
                        path: path.points.map(parseCoordinate),
                        ...(path.color ? { strokeColor: path.color } : {}),
                        ...(path.weight ? { strokeWeight: path.weight } : {}),
                        lineJoin: 'round',
                        lineCap: 'round',
                    }))
                }
                if (overlays.length > 0) {
                    map.add(overlays)
                    // 显式给了 center/zoom 就尊重调用方的视野；都没给才自动框选覆盖物
                    // （否则单个 marker 会被 fitView 顶到 17+ 级，zoom 参数形同虚设）
                    if (props.center === undefined && props.zoom === undefined) map.setFitView()
                }
            } catch (error) {
                console.error('[openui Map] interactive map failed', error)
                if (!cancelled) setFailed(true)
            }
        }
        void run()
        return () => {
            cancelled = true
            mapRef.current?.destroy()
            mapRef.current = null
        }
        // signature 已覆盖 props/view 的全部内容
    }, [signature])

    // 主题切换：JS API 地图需显式换样式（CSS 变量管不到 WebGL 画布）。
    // 海外自定义图层不吃 mapStyle，颜色随图层 URL 变化，已由 signature 触发重建
    useEffect(() => {
        if (overseas) return
        mapRef.current?.setMapStyle(scheme === 'dark' ? 'amap://styles/dark' : 'amap://styles/normal')
    }, [scheme, overseas])

    if (failed) return <MapFallback props={props} reason="交互地图加载失败" />
    return (
        <div style={{ position: 'relative', width: '100%', height }}>
            <div ref={container} data-mobi-map="interactive" style={{ width: '100%', height }} />
            {overseas ? <div style={attributionStyle}>© Esri</div> : null}
        </div>
    )
}

function MapView({ props }: ComponentRenderProps<MapProps>) {
    const [view, setView] = useState<MapSettingsView | null | undefined>(undefined)
    const streaming = useIsStreaming()

    useEffect(() => {
        let live = true
        void loadMapSettings().then((value) => {
            if (live) setView(value)
        })
        return () => {
            live = false
        }
    }, [])

    const height = clampHeight(props.height)
    if (view === undefined) return <div style={boxStyle(height)} />
    if (view === null) return <div style={boxStyle(height)}><MapFallback props={props} reason="地图设置不可用" /></div>
    if (view.mode === 'none') {
        return <div style={boxStyle(height)}><MapFallback props={props} reason="未配置高德地图 key" /></div>
    }
    // 流式期间 props 每个 delta 都变，两档都等 fence 封口再渲染：交互地图避免反复
    // 创建/销毁；静态图 URL 随参数变化，跟着流打代理会每 delta 都 miss 上游缓存
    // （高德静态图配额按请求计），烧几十次请求换不来可辨认的中间画面
    if (streaming) {
        return <div style={boxStyle(height)}><div style={loadingStyle}>地图加载中…</div></div>
    }
    return (
        <div style={boxStyle(height)}>
            {view.mode === 'interactive' ? <InteractiveMap props={props} view={view} height={height} /> : <StaticMap props={props} />}
        </div>
    )
}

export const mapComponent = defineComponent({ ...mapComponentSpec, component: MapView })
