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

import { defineComponent, type ComponentRenderProps } from '@openuidev/react-lang'
import { mapComponentSpec, type MapProps, type MapSettingsView } from '@mobi/shared'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { loadMapSettings } from '@/core/data/mapSettingsCache'

const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 140
const MAX_HEIGHT = 520

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
    }) => AMapMapInstance
    Marker: new (options: { position: Coordinate; title?: string }) => unknown
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

/** 静态图代理 URL（daemon 端拼高德参数并缓存；key 不在此出现） */
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

function useColorScheme(ref: RefObject<HTMLElement | null>): 'light' | 'dark' {
    const [scheme, setScheme] = useState<'light' | 'dark'>('light')
    useEffect(() => {
        const read = () => {
            const value = ref.current ? getComputedStyle(ref.current).colorScheme : ''
            setScheme(value.trim() === 'dark' ? 'dark' : 'light')
        }
        read()
        const observer = new MutationObserver(read)
        observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] })
        return () => observer.disconnect()
    }, [ref])
    return scheme
}

const boxStyle = (height: number): CSSProperties => ({
    position: 'relative',
    height,
    borderRadius: 12,
    overflow: 'hidden',
    // 底纹：图片/瓦片未就绪时不留纯色空白（rgba 双档通用，不依赖主题变量）
    background: 'var(--iui-surface, #f5f5f5)',
    backgroundImage:
        'linear-gradient(rgba(127, 127, 127, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(127, 127, 127, 0.08) 1px, transparent 1px)',
    backgroundSize: '28px 28px, 28px 28px',
    border: '1px solid var(--iui-border, #e5e5e5)',
})

const fallbackStyle: CSSProperties = {
    height: '100%',
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

function InteractiveMap({ props, view }: { props: MapProps; view: MapSettingsView }) {
    const container = useRef<HTMLDivElement>(null)
    const mapRef = useRef<AMapMapInstance | null>(null)
    const [failed, setFailed] = useState(false)
    const scheme = useColorScheme(container)
    const height = clampHeight(props.height)
    // props 每次渲染是新对象：用签名做 effect 依赖，避免地图反复销毁重建
    const signature = JSON.stringify([props, view.jsApiKey, view.securityJsCode])

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                if (!view.jsApiKey || !view.securityJsCode) {
                    setFailed(true)
                    return
                }
                // 安全密钥必须在 JS API 脚本加载前设置（高德明文模式）
                window._AMapSecurityConfig = { securityJsCode: view.securityJsCode }
                const { load } = await import('@amap/amap-jsapi-loader')
                const AMap = (await load({ key: view.jsApiKey, version: '2.0' })) as unknown as AMapNamespace
                if (cancelled || !container.current) return

                const center = props.center ? parseCoordinate(props.center) : undefined
                const map = new AMap.Map(container.current, {
                    zoom: props.zoom ?? 12,
                    ...(center ? { center } : {}),
                    viewMode: '2D',
                    mapStyle: scheme === 'dark' ? 'amap://styles/dark' : 'amap://styles/normal',
                })
                mapRef.current = map

                const overlays: unknown[] = []
                for (const marker of props.markers ?? []) {
                    overlays.push(new AMap.Marker({
                        position: parseCoordinate(marker.position),
                        ...(marker.label ? { title: marker.label } : {}),
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
            } catch {
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

    // 主题切换：JS API 地图需显式换样式（CSS 变量管不到 WebGL 画布）
    useEffect(() => {
        mapRef.current?.setMapStyle(scheme === 'dark' ? 'amap://styles/dark' : 'amap://styles/normal')
    }, [scheme])

    if (failed) return <MapFallback props={props} reason="交互地图加载失败" />
    return <div ref={container} data-mobi-map="interactive" style={{ width: '100%', height }} />
}

function MapView({ props }: ComponentRenderProps<MapProps>) {
    const [view, setView] = useState<MapSettingsView | null | undefined>(undefined)

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
    return (
        <div style={boxStyle(height)}>
            {view.mode === 'interactive' ? <InteractiveMap props={props} view={view} /> : <StaticMap props={props} />}
        </div>
    )
}

export const mapComponent = defineComponent({ ...mapComponentSpec, component: MapView })
