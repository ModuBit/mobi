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

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * 回归守卫：Select 焦点边框降档 + 打开面板不弱化选中文本
 *
 * 两个问题同一批修（DESIGN.md 输入框/下拉框规范）：
 * 1. antd Select 的 focus 边框默认走全局 colorPrimary（light 最深墨 / dark 最亮纸白的
 *    两极色），1px 实线刺眼——在 theme components.ts 里 light+dark 同时覆写
 *    activeBorderColor 为中灰 #87867f（与 Input 同阶梯）。
 * 2. antd 对 Select 类组件硬编码「面板打开时选中文本 opacity 0.25」（select-input.js，
 *    非 token）——选中值几乎消失；在 src/styles/antd.css 硬覆盖回 1。
 *
 * 此测试防止覆盖规则被重构/antd 升级时误删或漏配。
 */
describe('Select 焦点边框与打开态守卫', () => {
    const themePath = path.resolve(__dirname, '../src/core/config/theme/components.ts')
    const theme = fs.readFileSync(themePath, 'utf8')

    it('light + dark 的 Select 都覆写了 activeBorderColor（中灰，非 colorPrimary 两极色）', () => {
        // Input 与 Select 各 2 处（light/dark），四块全部落在 #87867f
        expect(theme.match(/activeBorderColor: '#87867f'/g)?.length).toBe(4)
    })

    it('antd.css 覆盖了 antd 打开面板时的选中内容弱化（opacity 0.25 → 1）', () => {
        const css = fs.readFileSync(
            path.resolve(__dirname, '../src/styles/antd.css'),
            'utf8',
        )
        const ruleMatch = css.match(
            /\.ant-select-open\s+\.ant-select-content-has-value[^{]*\{[^}]*\}/,
        )
        expect(ruleMatch).not.toBeNull()
        expect(ruleMatch![0]).toMatch(/opacity:\s*1\s*!important/)
    })
})
