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
 * 圆角档位一致性（文档与代码同源守卫，2026-10-13）。
 *
 * 圆角散在三处：DESIGN.md「Shapes」章（规范）、theme/tokens.ts（全局落点）、
 * theme/components.ts（组件级覆写）。此前只有人工同步，改一处漏一处是必然——
 * 本测试把「档位 → antd 槽位」的映射写死成一张契约表，任一边漂移即失败。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shadcnLightToken, shadcnDarkToken } from '@/core/config/theme/tokens'
import { shadcnLightComponents, shadcnDarkComponents } from '@/core/config/theme/components'
import { buildShadcnThemeCss } from '@/core/config/theme/cssVars'

const here = dirname(fileURLToPath(import.meta.url))
// 本文件在 packages/web/tests/core/config/theme/，向上四级回到包根
const designMd = readFileSync(resolve(here, '../../../../DESIGN.md'), 'utf-8')

/** 解析 frontmatter 的 rounded 块（正则，避免引入 yaml 依赖；照 presets-consistency 先例） */
function readDesignTiers(): Record<string, number> {
    const block = designMd.match(/^rounded:\n((?:[ \t].*\n)+)/m)
    if (!block) throw new Error('DESIGN.md frontmatter 缺少 rounded 块')
    const tiers: Record<string, number> = {}
    for (const line of block[1].split('\n')) {
        const hit = line.match(/^\s+([a-z][a-z-]*):\s*(\d+)px/)
        if (hit) tiers[hit[1]!] = Number(hit[2])
    }
    return tiers
}

const tiers = readDesignTiers()

/** 档位 → antd 全局槽位。这是文档与代码之间的契约，改档位必须两边一起改 */
const TOKEN_SLOTS = [
    ['control', 'borderRadius'],
    ['control-sm', 'borderRadiusSM'],
    ['panel', 'borderRadiusLG'],
    ['square', 'borderRadiusXS'],
] as const

/** 组件级圆角覆写：只允许覆写成**与全局槽位不同**的档（同值覆写＝第二个事实源） */
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

describe('圆角档位与 DESIGN.md 一致性（文档与代码同源守卫）', () => {
    it.each(['light', 'dark'] as const)('%s 档的四条全局槽位与文档数值一致', mode => {
        const token = mode === 'dark' ? shadcnDarkToken : shadcnLightToken
        for (const [tier, slot] of TOKEN_SLOTS) {
            expect(token[slot], `${mode} 档 ${tier} → ${slot}`).toBe(tiers[tier])
        }
    })

    it('两档同值（圆角不分主题；颜色才分）', () => {
        for (const [, slot] of TOKEN_SLOTS) {
            expect(shadcnDarkToken[slot]).toBe(shadcnLightToken[slot])
        }
    })

    it('主体三档等差 8px（每跳观感增幅一致，不出现突档）', () => {
        expect(tiers['panel']! - tiers['control']!).toBe(8)
        expect(tiers['surface']! - tiers['panel']!).toBe(8)
    })

    it('控件小号档 = 控件档 − 4（uiarc 同法）', () => {
        expect(tiers['control']! - tiers['control-sm']!).toBe(4)
    })

    it.each([
        ['light', shadcnLightComponents, shadcnLightToken],
        ['dark', shadcnDarkComponents, shadcnDarkToken],
    ] as const)('%s 组件覆写：Modal 走大表面档、Alert 走控件档、Checkbox 走方角档', (mode, components, token) => {
        expect(components.Modal.borderRadiusLG, `${mode} Modal`).toBe(tiers['surface'])
        expect(components.Alert.borderRadiusLG, `${mode} Alert`).toBe(tiers['control'])
        expect(components.Checkbox.borderRadiusSM, `${mode} Checkbox`).toBe(tiers['square'])
    })

    it.each([
        ['light', shadcnLightComponents],
        ['dark', shadcnDarkComponents],
    ] as const)('%s 不存在「与全局同值」的冗余覆写', (_mode, components) => {
        const globals = Object.fromEntries(TOKEN_SLOTS.map(([tier, slot]) => [slot, tiers[tier]]))
        for (const { component, key, value } of radiusOverrides(components)) {
            // 值必须是文档里的某一档，且不能等于该槽位的全局值（那就是冗余覆写）
            expect(Object.values(tiers), `${component}.${key} 的值不在档位表里`).toContain(value)
            expect(value, `${component}.${key} 与全局 ${key} 同值，冗余覆写应删除`).not.toBe(globals[key])
        }
    })

    it('shadcn 变量投影跟随档位（registry 组件消费的 --radius / --radius-lg）', () => {
        const css = buildShadcnThemeCss('light')
        expect(css).toContain(`--radius: ${tiers['control']}px`)
        expect(css).toContain(`--radius-lg: ${tiers['panel']}px`)
    })
})
