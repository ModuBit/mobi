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
 * 圆角档位守卫（2026-10-13）。
 *
 * 圆角散在四处：DESIGN.md「Shapes」章（规格）、theme/tokens.ts（档位表 = 唯一数值源）、
 * theme/components.ts（组件级覆写）、以及各处取档引用。此前全靠人工同步，改一处漏一处是必然。
 * 本测试把三件事锁死：
 *   ① 档位表：DESIGN.md ←→ tokens.ts.RADIUS_TIERS ←→ antd 槽位 ←→ 注入的 CSS 变量；
 *   ② 组件覆写只允许落到指定档，且不许出现「与全局同值」的冗余覆写；
 *   ③ **源码里不许再出现等于档位值的字面量**——散落的字面量正是「逐个调不动」的根因。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { shadcnLightToken, shadcnDarkToken, RADIUS_TIERS, RADIUS_TIER_KEYS } from '@/core/config/theme/tokens'
import { shadcnLightComponents, shadcnDarkComponents } from '@/core/config/theme/components'
import { buildShadcnThemeCss } from '@/core/config/theme/cssVars'
import { collectSourceFiles, readDesignBlock, WEB_ROOT } from '../../../helpers/themeGuards'

/** 解析 frontmatter 的 rounded 块 */
function readDesignTiers(): Record<string, number> {
    const tiers: Record<string, number> = {}
    for (const line of readDesignBlock('rounded')) {
        const hit = line.match(/^\s+([a-z][a-z-]*):\s*(\d+)px/)
        if (hit) tiers[hit[1]!] = Number(hit[2])
    }
    return tiers
}

const designTiers = readDesignTiers()

/** 档位 → antd 全局槽位（icon / surface 两档没有槽位，见 tokens.ts 注释） */
const TOKEN_SLOTS = [
    ['control', 'borderRadius'],
    ['control-sm', 'borderRadiusSM'],
    ['panel', 'borderRadiusLG'],
    ['square', 'borderRadiusXS'],
] as const

/** 组件级圆角覆写：只允许覆写成与全局槽位**不同**的档（同值覆写＝第二个事实源） */
function radiusOverrides(theme: unknown): Array<{ component: string; key: string; value: number }> {
    const out: Array<{ component: string; key: string; value: number }> = []
    for (const [component, slots] of Object.entries(theme as Record<string, unknown>)) {
        if (typeof slots !== 'object' || slots === null) continue
        for (const [key, value] of Object.entries(slots as Record<string, unknown>)) {
            if (key.startsWith('borderRadius') && typeof value === 'number') out.push({ component, key, value })
        }
    }
    return out
}

/**
 * 圆角字面量例外——两处，各有明确理由，**按具体文件列，不开目录级豁免**（整目录豁免会把
 * 该目录里真正该取档的字面量一起放过：2026-10-13 实测 src/styles 下就躲着三处，其中两处
 * 正是图标档的值）：
 *   ① 代码编辑器内部的密集 chrome：圆角按内容密度独立取值，不属外壳档位体系；
 *   ② 注入到产物 iframe 文档的样式（SandboxHtmlFrame）：CSS 自定义属性不跨文档，宿主
 *      `:root` 的取档变量在那个文档里不存在，只能写字面量（见 DESIGN.md「Shapes」）。
 */
const RADIUS_LITERAL_EXCEPTIONS = ['src/features/files/editor.css', 'src/ui/base/sandbox/SandboxHtmlFrame.tsx']

/** 去掉注释再扫：档位值常出现在解释性注释里（「面板档 22px」），那不是声明 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('圆角档位与 DESIGN.md 一致性（文档与代码同源守卫）', () => {
    it.each(['light', 'dark'] as const)('%s 档的四条 antd 槽位与文档数值一致', mode => {
        const token = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
        for (const [tier, slot] of TOKEN_SLOTS) {
            expect(token[slot], `${mode} 档 ${tier} → ${slot}`).toBe(designTiers[tier])
        }
    })

    it('文档档位表与代码档位表逐档对齐（不多不少）', () => {
        const codeTiers = Object.entries(RADIUS_TIER_KEYS).map(([docKey, codeKey]) => [docKey, RADIUS_TIERS[codeKey]] as const)
        expect(Object.fromEntries(codeTiers)).toEqual(designTiers)
    })

    it('两档同值（圆角不分主题；颜色才分）', () => {
        for (const [, slot] of TOKEN_SLOTS) {
            expect(shadcnDarkToken[slot]).toBe(shadcnLightToken[slot])
        }
    })

    it('主体三档等差 8px（每跳观感增幅一致，不出现突档）', () => {
        expect(designTiers['panel']! - designTiers['control']!).toBe(8)
        expect(designTiers['surface']! - designTiers['panel']!).toBe(8)
    })

    it('控件小号档 = 控件档 − 4（uiarc 同法）', () => {
        expect(designTiers['control']! - designTiers['control-sm']!).toBe(4)
    })

    it('每个档位都投成同名 CSS 变量（角色名即变量名）', () => {
        const css = buildShadcnThemeCss('light')
        for (const [docKey, value] of Object.entries(designTiers)) {
            expect(css, `--radius-${docKey}`).toContain(`--radius-${docKey}: ${value}px`)
        }
        // shadcn 生态兼容名保留（registry 组件按 --radius / --radius-lg 取档）
        expect(css).toContain(`--radius: ${RADIUS_TIERS.control}px`)
        expect(css).toContain(`--radius-lg: ${RADIUS_TIERS.panel}px`)
    })

    it.each([
        ['light', shadcnLightComponents],
        ['dark', shadcnDarkComponents],
    ] as const)('%s 组件覆写：Modal 走大表面档、Alert 走控件档、Checkbox 走方角档', (mode, components) => {
        expect(components.Modal.borderRadiusLG, `${mode} Modal`).toBe(designTiers['surface'])
        expect(components.Alert.borderRadiusLG, `${mode} Alert`).toBe(designTiers['control'])
        expect(components.Checkbox.borderRadiusSM, `${mode} Checkbox`).toBe(designTiers['square'])
    })

    it.each([
        ['light', shadcnLightComponents],
        ['dark', shadcnDarkComponents],
    ] as const)('%s 不存在「与全局同值」的冗余覆写', (_mode, components) => {
        const globals = Object.fromEntries(TOKEN_SLOTS.map(([tier, slot]) => [slot, designTiers[tier]]))
        for (const { component, key, value } of radiusOverrides(components)) {
            expect(Object.values(designTiers), `${component}.${key} 的值不在档位表里`).toContain(value)
            expect(value, `${component}.${key} 与全局 ${key} 同值，冗余覆写应删除`).not.toBe(globals[key])
        }
    })

    it('源码里没有等于档位值的 border-radius 字面量（一律取档引用）', () => {
        const tierValues = new Set(Object.values(designTiers))
        const offenders: string[] = []
        for (const file of collectSourceFiles(resolve(WEB_ROOT, 'src'))) {
            const rel = relative(WEB_ROOT, file)
            if (RADIUS_LITERAL_EXCEPTIONS.some((prefix) => rel.startsWith(prefix))) continue
            const source = stripComments(readFileSync(file, 'utf-8'))
            for (const decl of source.matchAll(/border-radius:\s*([^;{}\n]*)/g)) {
                const value = decl[1]!.trim()
                // calc() 里的数值是结构性的内缩量（同心公式），不是取档
                if (value.startsWith('calc(')) continue
                for (const px of value.matchAll(/(\d+)px/g)) {
                    if (tierValues.has(Number(px[1]))) offenders.push(`${rel} → border-radius: ${value}`)
                }
            }
        }
        expect(offenders, `这些字面量应改成 var(--radius-<档名>)`).toEqual([])
    })
})
