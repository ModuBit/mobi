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
 * Svg 图元组件签名（票 03 移植）——与 chart.ts 同构：只含生成端协议。
 * Svg 只是一个容器，真正画东西靠 Circle/Rect/Path 等图元，故 10 个组件
 * 同属本模块（单模块组织）。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/components/svg.tsx`
 * （MIT，完整许可声明见本目录 index.ts）。与上游的差异：`tagSchemaId` 标记
 * 保留（prompt 里把 children 打印成 Node、颜色打印成 Color、长度打印成 Length）。
 */

import { tagSchemaId } from '@openuidev/lang-core'
import { z } from 'zod'

/** 子节点槽：任意组件或其列表（@Each 产出），prompt 中打印为 `Node[]` */
const node = z.any()
tagSchemaId(node, 'Node')
export const children = z.array(node)

/** token 或 CSS 颜色，prompt 中打印为 `Color`（token 词汇见 web 侧 fg 映射） */
export const color = z.string()
tagSchemaId(color, 'Color')

/** px 数字或 CSS 长度（如 "50%"），prompt 中打印为 `Length` */
export const length = z.union([z.number(), z.string()])
tagSchemaId(length, 'Length')

const paint = {
    fill: color.optional(),
    stroke: color.optional(),
    strokeWidth: z.number().optional(),
    opacity: z.number().optional(),
}

export const svgComponentSpec = {
    name: 'Svg',
    props: z.object({ children, viewBox: z.string(), width: length.optional(), height: length.optional() }),
    description:
        'A drawing for steps, parts, mechanisms, diagrams and layouts. Scales to its width; its shapes take expressions, so state can move them.',
} as const

export const circleComponentSpec = {
    name: 'Circle',
    props: z.object({ cx: z.number(), cy: z.number(), r: z.number(), ...paint }),
    description: '',
} as const

export const ellipseComponentSpec = {
    name: 'Ellipse',
    props: z.object({ cx: z.number(), cy: z.number(), rx: z.number(), ry: z.number(), ...paint }),
    description: '',
} as const

export const rectComponentSpec = {
    name: 'Rect',
    props: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), ...paint, rx: z.number().optional() }),
    description: '',
} as const

export const lineComponentSpec = {
    name: 'Line',
    props: z.object({
        x1: z.number(),
        y1: z.number(),
        x2: z.number(),
        y2: z.number(),
        stroke: color.optional(),
        strokeWidth: z.number().optional(),
        opacity: z.number().optional(),
    }),
    description: '',
} as const

export const pathComponentSpec = {
    name: 'Path',
    props: z.object({ d: z.string(), ...paint }),
    description: '',
} as const

export const polylineComponentSpec = {
    name: 'Polyline',
    props: z.object({
        points: z.string(),
        stroke: color.optional(),
        strokeWidth: z.number().optional(),
        fill: color.optional(),
        opacity: z.number().optional(),
    }),
    description: 'points like "0,0 10,5 20,0".',
} as const

export const polygonComponentSpec = {
    name: 'Polygon',
    props: z.object({ points: z.string(), ...paint }),
    description: '',
} as const

export const gComponentSpec = {
    name: 'G',
    props: z.object({ children, transform: z.string().optional(), opacity: z.number().optional() }),
    description: 'Group; transform like "rotate(30 50 50)" or "translate(10 0)".',
} as const

export const svgTextComponentSpec = {
    name: 'SvgText',
    props: z.object({
        text: z.string(),
        x: z.number(),
        y: z.number(),
        size: z.number().optional(),
        fill: color.optional(),
        anchor: z.enum(['start', 'middle', 'end']).optional(),
        weight: z.enum(['normal', 'medium', 'semibold']).optional(),
    }),
    description: '',
} as const

/** 全部 Svg 图元签名（Svg 容器在前，图元按上游顺序） */
export const svgComponentSpecs = [
    svgComponentSpec,
    circleComponentSpec,
    ellipseComponentSpec,
    rectComponentSpec,
    lineComponentSpec,
    pathComponentSpec,
    polylineComponentSpec,
    polygonComponentSpec,
    gComponentSpec,
    svgTextComponentSpec,
]
