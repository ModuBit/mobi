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
 * 配色守卫（2026-10-13）。与 radius-consistency 同法，把配色的四处事实锁在一起：
 *   ① DESIGN.md「Colors」章（规格）←→ tokens.ts 的 NEUTRAL_LIGHT / NEUTRAL_DARK / SEMANTIC_*（唯一数值源）；
 *   ② 体系不变量：中性阶**不含色相倾向**（色度 ≤ 5）、层次**每跳 ≥ 2 L\***、语义色**双档同族**（色相差 ≤ 20°）；
 *   ③ 每个中性档都投成 `--mobi-<档名>` CSS 变量（`src/styles` 与自绘件全靠它取色）；
 *   ④ **源码里不许再出现等于档位值的十六进制字面量**——散落的字面量正是「配色一改漏一片」的根因
 *      （改前 markdown.css 一处就抄了 39 个、components.ts 抄了 40+ 个）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { CHROME_BG } from '@mobi/shared'
import { NEUTRAL_LIGHT, NEUTRAL_DARK, SEMANTIC_LIGHT, SEMANTIC_DARK, type NeutralKey } from '@/core/config/theme/tokens'
import { buildShadcnThemeCss } from '@/core/config/theme/cssVars'
import { collectSourceFiles, readDesignBlock, WEB_ROOT } from '../../../helpers/themeGuards'

/** DESIGN.md 里的档名 → tokens.ts 的键名 */
const KEY_MAP: Record<string, NeutralKey> = {
    canvas: 'canvas',
    paper: 'container',
    elevated: 'elevated',
    hover: 'hover',
    selected: 'selected',
    pressed: 'pressed',
    ink: 'ink',
    'ink-secondary': 'inkSecondary',
    'ink-tertiary': 'inkTertiary',
    'ink-quaternary': 'inkQuaternary',
    primary: 'primary',
    hairline: 'hairline',
    'hairline-strong': 'hairlineStrong',
}

/** 解析 frontmatter 里的一个色板块 */
function readDesignColors(block: 'colors' | 'colors-dark'): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of readDesignBlock(block)) {
        if (/^\s*#/.test(line)) continue // 块内注释
        const hit = line.match(/^\s{2}([a-z][a-z-]*):\s*"(#[0-9a-f]{6})"/)
        if (hit) out[hit[1]!] = hit[2]!
    }
    return out
}

const designLight = readDesignColors('colors')
const designDark = readDesignColors('colors-dark')

/* ---------- 色彩空间小工具（仅本测试用，不引入运行时依赖） ---------- */
const srgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function toLab(hex: string): [number, number, number] {
    const [r, g, b] = [1, 3, 5].map((i) => srgb(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const [fx, fy, fz] = [f(X), f(Y), f(Z)]
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** L\*C\*h：明度 / 色度 / 色相角 */
function lch(hex: string): [number, number, number] {
    const [L, a, b] = toLab(hex)
    const h = (Math.atan2(b, a) * 180) / Math.PI
    return [L, Math.hypot(a, b), h < 0 ? h + 360 : h]
}

const hueGap = (x: string, y: string) => {
    const d = Math.abs(lch(x)[2] - lch(y)[2]) % 360
    return d > 180 ? 360 - d : d
}

describe('配色与 DESIGN.md 一致性（文档与代码同源守卫）', () => {
    it.each([
        ['light', NEUTRAL_LIGHT, designLight],
        ['dark', NEUTRAL_DARK, designDark],
    ] as const)('%s 档中性阶逐档与文档一致（不多不少）', (mode, ramp, design) => {
        const fromDesign = Object.fromEntries(Object.keys(KEY_MAP).map((docKey) => [KEY_MAP[docKey]!, design[docKey]]))
        expect(fromDesign, `${mode} 档中性阶`).toEqual(ramp)
    })

    it.each([
        ['light', designLight],
        ['dark', designDark],
    ] as const)('%s 档的 focus 描边取中灰档（hairline-active = ink-tertiary）', (_mode, design) => {
        const ramp = _mode === 'dark' ? NEUTRAL_DARK : NEUTRAL_LIGHT
        expect(design['hairline-active']).toBe(ramp.inkTertiary)
    })

    it('实心按钮上的字 = 纸色（light 白字 / dark 底色字）', () => {
        expect(designLight['on-primary']).toBe(NEUTRAL_LIGHT.elevated)
        expect(designDark['on-primary']).toBe(NEUTRAL_DARK.canvas)
    })

    it.each([
        ['light', SEMANTIC_LIGHT, designLight],
        ['dark', SEMANTIC_DARK, designDark],
    ] as const)('%s 档语义色种子与文档一致', (_mode, seeds, design) => {
        expect({ success: design['success'], warning: design['warning'], danger: design['danger'] }).toEqual(seeds)
    })

    it('中性阶不含色相倾向（色度 ≤ 5，层次由明度单独承担）', () => {
        for (const [mode, ramp] of [['light', NEUTRAL_LIGHT], ['dark', NEUTRAL_DARK]] as const) {
            for (const [key, hex] of Object.entries(ramp)) {
                expect(lch(hex)[1], `${mode}.${key} 带了色相倾向`).toBeLessThanOrEqual(5)
            }
        }
    })

    it('层次每跳 ≥ 2 L*（画布→容器→抬升，以及 hover→selected→pressed）', () => {
        const L = (x: string) => lch(x)[0]
        const steps: Array<[string, number]> = [
            ['light paper−canvas', L(NEUTRAL_LIGHT.container) - L(NEUTRAL_LIGHT.canvas)],
            ['light elevated−paper', L(NEUTRAL_LIGHT.elevated) - L(NEUTRAL_LIGHT.container)],
            ['light hover−selected', L(NEUTRAL_LIGHT.hover) - L(NEUTRAL_LIGHT.selected)],
            ['light selected−pressed', L(NEUTRAL_LIGHT.selected) - L(NEUTRAL_LIGHT.pressed)],
            ['dark paper−canvas', L(NEUTRAL_DARK.container) - L(NEUTRAL_DARK.canvas)],
            ['dark elevated−paper', L(NEUTRAL_DARK.elevated) - L(NEUTRAL_DARK.container)],
            ['dark selected−hover', L(NEUTRAL_DARK.selected) - L(NEUTRAL_DARK.hover)],
        ]
        for (const [name, step] of steps) expect(step, name).toBeGreaterThanOrEqual(2)
    })

    it('语义色双档同族（色相差 ≤ 20°，只许动明度与彩度）', () => {
        for (const key of ['success', 'warning', 'danger'] as const) {
            expect(hueGap(SEMANTIC_LIGHT[key], SEMANTIC_DARK[key]), `${key} 两档色相不同族`).toBeLessThanOrEqual(20)
        }
    })

    it('dark 语义色比 light 更亮（暗底可读）', () => {
        for (const key of ['success', 'warning', 'danger'] as const) {
            expect(lch(SEMANTIC_DARK[key])[0], `${key} 未在 dark 档提亮`).toBeGreaterThan(lch(SEMANTIC_LIGHT[key])[0])
        }
    })

    it('窗口 chrome 色 = light 容器 / dark 画布（shared 的 CHROME_BG，跨包共引的那一份）', () => {
        // chrome（系统栏/标签栏/WCO 标题栏）必须与页面最外层表面同色，否则两者之间裂一道边。
        // daemon 拼 manifest 也要这个色却够不着本包，故值落在 @mobi/shared——等式在这里锁死。
        expect(CHROME_BG.light).toBe(NEUTRAL_LIGHT.container)
        expect(CHROME_BG.dark).toBe(NEUTRAL_DARK.canvas)
    })

    it('index.html 的 theme-color 兜底值与 chrome 色一致（React 加载前的首屏着色）', () => {
        const html = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf-8')
        for (const [mode, expected] of [
            ['light', CHROME_BG.light],
            ['dark', CHROME_BG.dark],
        ] as const) {
            const meta = html.match(new RegExp(`content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${mode}\\)"`))
            expect(meta?.[1], `index.html ${mode} 档 theme-color`).toBe(expected)
        }
        // 首屏内联脚本里的字面量（React 加载前改 meta 的那段）同一事实
        const script = html.match(/var color = resolved === 'dark' \? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})'/)
        expect(script?.[1], 'index.html 首屏脚本 dark 色').toBe(CHROME_BG.dark)
        expect(script?.[2], 'index.html 首屏脚本 light 色').toBe(CHROME_BG.light)
    })

    it.each(['light', 'dark'] as const)('%s 档每个中性档都投成 --mobi-<档名> CSS 变量', (mode) => {
        const css = buildShadcnThemeCss(mode)
        const ramp = mode === 'dark' ? NEUTRAL_DARK : NEUTRAL_LIGHT
        for (const [docKey, key] of Object.entries(KEY_MAP)) {
            const cssVar = docKey === 'paper' ? '--mobi-paper' : `--mobi-${docKey}`
            expect(css, cssVar).toContain(`${cssVar}: ${ramp[key]}`)
        }
    })

    it('源码里没有等于档位值的十六进制字面量（一律取 token / var）', () => {
        // 白色（elevated）单独放过：图标、SVG、遮罩里的 #ffffff 是通用白，不构成配色漂移
        const rampValues = new Set(
            [...Object.values(NEUTRAL_LIGHT), ...Object.values(NEUTRAL_DARK), ...Object.values(SEMANTIC_LIGHT), ...Object.values(SEMANTIC_DARK)]
                .map((v) => v.toLowerCase())
                .filter((v) => v !== '#ffffff'),
        )
        const EXCEPTIONS = ['src/core/config/theme/tokens.ts'] // 档位表本身
        const offenders: string[] = []
        for (const file of collectSourceFiles(resolve(WEB_ROOT, 'src'))) {
            const rel = relative(WEB_ROOT, file)
            if (EXCEPTIONS.includes(rel)) continue
            for (const hit of readFileSync(file, 'utf-8').matchAll(/#[0-9a-fA-F]{6}/g)) {
                if (rampValues.has(hit[0].toLowerCase())) offenders.push(`${rel} → ${hit[0]}`)
            }
        }
        expect(offenders, '这些字面量应改成 token 引用或 var(--mobi-*)').toEqual([])
    })
})
