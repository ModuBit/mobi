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
 * Map 组件签名（高德地图）——只含生成端协议（name/props/description），
 * React 实现留在 web（`ui/openui/mapComponent.tsx`），与 Chart/Svg 同构。
 *
 * 渲染档位由 daemon 设置的 key 决定（见 shared mapSettings）：配了 JS API
 * key + 安全密钥走交互地图，否则有 Web 服务 key 走静态图，都没有则降级为
 * 高德 URI 链接。签名三档一致——模型不需要感知当前部署启用了哪一档。
 */

import { z } from 'zod'

/** 经纬度字符串 "lng,lat"（高德坐标，GCJ-02） */
export const mapCoordinate = z
    .string()
    .regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/, 'expected "lng,lat"')

export const mapMarkerSchema = z.object({
    /** 经纬度 "lng,lat" */
    position: mapCoordinate,
    /** 标注文字（可选；静态图会出现在标注旁） */
    label: z.string().optional(),
})

export const mapPathSchema = z.object({
    /** 折线顶点列表 "lng,lat" */
    points: z.array(mapCoordinate).min(2),
    /** 线条颜色，CSS 色值（如 "#ff6600"） */
    color: z.string().optional(),
    /** 线宽（像素） */
    weight: z.number().optional(),
})

export const mapProps = z.object({
    /** 地图中心 "lng,lat"；有 markers/paths 时可省略（自动取包围中心） */
    center: mapCoordinate.optional(),
    /** 缩放级别 3-18；省略时按覆盖物自动计算 */
    zoom: z.number().optional(),
    markers: z.array(mapMarkerSchema).optional(),
    paths: z.array(mapPathSchema).optional(),
    /** 渲染高度（像素），默认 280 */
    height: z.number().optional(),
})

export const mapComponentSpec = {
    name: 'Map',
    props: mapProps,
    description:
        'Geographic map (AMap) for locations and routes: center is "lng,lat" (GCJ-02), zoom 3-18; markers are {position: "lng,lat", label?}; paths are {points: ["lng,lat", ...], color?, weight?}. Keep 12 markers or fewer and 3 paths or fewer so the map stays readable on phones.',
} as const

export type MapProps = z.infer<typeof mapProps>
