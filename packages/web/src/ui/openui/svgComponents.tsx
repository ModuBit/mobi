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
 * Svg 图元组件实现（票 03 移植）：容器 + 9 个图元（Circle/Ellipse/Rect/Line/
 * Path/Polyline/Polygon/G/SvgText）。签名在 shared，这里挂 React 实现。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/components/svg.tsx`
 * 与 `style.ts` 的颜色/尺寸辅助（MIT，许可声明见 shared `openuiComponents/index.ts`）。
 * 与上游的差异：
 * - 颜色 token 改投 mobi 主题变量（`--iui-*` 别名在 styles/openui.css 定义）；
 *   purple/pink 在 mobi 调色板里没有独立色相，回落图表分类色的紫/粉两档；
 * - 安全校验逐段保留：所有属性在此检查，任何值都不能加载资源或执行代码。
 */

import { defineComponent, type ComponentRenderProps } from '@openuidev/react-lang'
import {
    circleComponentSpec,
    ellipseComponentSpec,
    gComponentSpec,
    lineComponentSpec,
    pathComponentSpec,
    polygonComponentSpec,
    polylineComponentSpec,
    rectComponentSpec,
    svgComponentSpec,
    svgTextComponentSpec,
} from '@mobi/shared'

// 数值守卫：非有限数一律丢弃，交给 SVG 默认值
const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const opacity = (value: unknown) => (n(value) === undefined ? undefined : Math.min(1, Math.max(0, value as number)))
const POINTS = /^[\d\s,.eE+-]*$/
const PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]*$/
// 每个 transform 函数合法的参数个数——未初始化状态拼出的 "rotate( 90 80)" 直接丢弃，不进 DOM
const TRANSFORM_ARGS: Record<string, number[]> = {
    translate: [1, 2],
    rotate: [1, 3],
    scale: [1, 2],
    skewX: [1],
    skewY: [1],
    matrix: [6],
}
function transform(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 500) return undefined
    const parts = [...value.matchAll(/\s*([a-zA-Z]+)\(([^()]*)\)\s*/g)]
    if (!parts.length || parts.map((p) => p[0]).join('') !== value) return undefined
    const valid = parts.every(([, name, args]) => {
        const numbers = args!.trim().split(/\s*,\s*|\s+/).filter(Boolean)
        return (TRANSFORM_ARGS[name!]?.includes(numbers.length) ?? false) && numbers.every((v) => Number.isFinite(Number(v)))
    })
    return valid ? value.trim() : undefined
}
const ok = (value: unknown, pattern: RegExp) =>
    typeof value === 'string' && value.length < 20000 && pattern.test(value) ? value : undefined

type Paint = { fill?: string; stroke?: string; strokeWidth?: number; opacity?: number }

// 模型可用的颜色 token → mobi 主题变量（样式表的 --iui-* 别名见 styles/openui.css）。
// 安全底线：只认白名单 token 或经 isSafeCss 校验的 CSS 值，url()/var()/attr() 等一律拒绝。
const UNSAFE_CSS = /(url|image|image-set|cross-fade|element|expression|paint|var|attr|env)\s*\(|@import|[\\;{}<>]/i
const isSafeCss = (value: string) => !UNSAFE_CSS.test(value)
const cssValue = (value: unknown) =>
    typeof value === 'string' && value.trim() && isSafeCss(value) ? value.trim() : undefined

const FOREGROUND: Record<string, string> = {
    ink: 'var(--iui-ink)',
    muted: 'var(--iui-muted)',
    faint: 'var(--iui-faint)',
    canvas: 'var(--iui-canvas)',
    surface: 'var(--iui-surface)',
    'surface-strong': 'var(--iui-surface-strong)',
    border: 'var(--iui-border)',
    info: 'var(--iui-info)',
    success: 'var(--iui-success)',
    warning: 'var(--iui-warning)',
    danger: 'var(--iui-danger)',
    // mobi 调色板无独立紫/粉：回落图表分类色的紫（6）与粉（5）两档
    purple: 'var(--mobi-chart-6)',
    pink: 'var(--mobi-chart-5)',
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`chart${i + 1}`, `var(--mobi-chart-${i + 1})`])),
}

/** 文字、图标与描边颜色：token 或经校验的 CSS 颜色 */
const fg = (value: unknown) => (typeof value === 'string' ? (FOREGROUND[value] ?? cssValue(value)) : undefined)

/** px 数字或 CSS 长度（"50%" / "auto"），其余丢弃 */
function size(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return `${Math.max(0, value)}px`
    if (typeof value !== 'string') return undefined
    if (/^\d+(\.\d+)?$/.test(value.trim())) return `${value.trim()}px`
    return /^\d+(\.\d+)?(px|%|em|rem|vh|vw|fr)$|^auto$/.test(value.trim()) ? value.trim() : undefined
}

/** 填充图形默认取文字色；只有描边时保持不填充 */
const paintAttrs = (p: Paint, filled: boolean) => ({
    fill: p.fill !== undefined ? (fg(p.fill) ?? 'none') : filled && p.stroke === undefined ? 'currentColor' : 'none',
    stroke: p.stroke !== undefined ? fg(p.stroke) : filled ? undefined : 'currentColor',
    strokeWidth: n(p.strokeWidth) ?? (filled ? undefined : 2),
    opacity: opacity(p.opacity),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
})

function SvgView({ props, renderNode }: ComponentRenderProps) {
    const p = props as { children?: unknown; viewBox: string; width?: number | string; height?: number | string }
    const viewBox = ok(p.viewBox, /^\s*[-\d.]+(\s*[\s,]\s*[-\d.]+){3}\s*$/) ?? '0 0 100 100'
    // 不传宽度时填满列，上限 1.5x viewBox（至少 280px），保证文字不变形
    const natural = Number(viewBox.trim().split(/[\s,]+/)[2])
    const maxWidth = p.width == null && natural > 0 ? `${Math.max(280, natural * 1.5)}px` : undefined
    return (
        <svg
            className="iui-svg"
            viewBox={viewBox}
            style={{ width: size(p.width) ?? '100%', maxWidth, height: size(p.height) }}
            role="img"
            preserveAspectRatio="xMidYMid meet"
        >
            {renderNode(p.children as never)}
        </svg>
    )
}

export const svgComponent = defineComponent({ ...svgComponentSpec, component: SvgView })

export const circleComponent = defineComponent({
    ...circleComponentSpec,
    component: ({ props }) => {
        const p = props as { cx: number; cy: number; r: number } & Paint
        return <circle cx={n(p.cx)} cy={n(p.cy)} r={Math.max(0, n(p.r) ?? 0)} {...paintAttrs(p, true)} />
    },
})

export const ellipseComponent = defineComponent({
    ...ellipseComponentSpec,
    component: ({ props }) => {
        const p = props as { cx: number; cy: number; rx: number; ry: number } & Paint
        return <ellipse cx={n(p.cx)} cy={n(p.cy)} rx={Math.max(0, n(p.rx) ?? 0)} ry={Math.max(0, n(p.ry) ?? 0)} {...paintAttrs(p, true)} />
    },
})

export const rectComponent = defineComponent({
    ...rectComponentSpec,
    component: ({ props }) => {
        const p = props as { x: number; y: number; width: number; height: number; rx?: number } & Paint
        return (
            <rect
                x={n(p.x)}
                y={n(p.y)}
                width={Math.max(0, n(p.width) ?? 0)}
                height={Math.max(0, n(p.height) ?? 0)}
                rx={n(p.rx)}
                {...paintAttrs(p, true)}
            />
        )
    },
})

export const lineComponent = defineComponent({
    ...lineComponentSpec,
    component: ({ props }) => {
        const p = props as { x1: number; y1: number; x2: number; y2: number } & Paint
        return <line x1={n(p.x1)} y1={n(p.y1)} x2={n(p.x2)} y2={n(p.y2)} {...paintAttrs(p, false)} />
    },
})

export const pathComponent = defineComponent({
    ...pathComponentSpec,
    component: ({ props }) => {
        const p = props as { d: string } & Paint
        return <path d={ok(p.d, PATH)} {...paintAttrs(p, p.fill !== undefined)} />
    },
})

export const polylineComponent = defineComponent({
    ...polylineComponentSpec,
    component: ({ props }) => {
        const p = props as { points: string } & Paint
        return <polyline points={ok(p.points, POINTS)} {...paintAttrs(p, false)} />
    },
})

export const polygonComponent = defineComponent({
    ...polygonComponentSpec,
    component: ({ props }) => {
        const p = props as { points: string } & Paint
        return <polygon points={ok(p.points, POINTS)} {...paintAttrs(p, true)} />
    },
})

export const gComponent = defineComponent({
    ...gComponentSpec,
    component: ({ props, renderNode }) => {
        const p = props as { children?: unknown; transform?: string; opacity?: number }
        return (
            <g transform={transform(p.transform)} opacity={opacity(p.opacity)}>
                {renderNode(p.children as never)}
            </g>
        )
    },
})

export const svgTextComponent = defineComponent({
    ...svgTextComponentSpec,
    component: ({ props }) => {
        const p = props as {
            text: string
            x: number
            y: number
            size?: number
            fill?: string
            anchor?: 'start' | 'middle' | 'end'
            weight?: 'normal' | 'medium' | 'semibold'
        }
        return (
            <text
                x={n(p.x)}
                y={n(p.y)}
                fontSize={n(p.size) ?? 12}
                fill={fg(p.fill) ?? 'currentColor'}
                textAnchor={p.anchor ?? 'start'}
                fontWeight={p.weight === 'semibold' ? 640 : p.weight === 'medium' ? 560 : 440}
                fontFamily="var(--iui-font)"
            >
                {String(p.text ?? '')}
            </text>
        )
    },
})

/** 全量 Svg 图元（mobiLibrary 注册用；顺序与 shared 签名表一致） */
export const svgComponents = [
    svgComponent,
    circleComponent,
    ellipseComponent,
    rectComponent,
    lineComponent,
    pathComponent,
    polylineComponent,
    polygonComponent,
    gComponent,
    svgTextComponent,
]
