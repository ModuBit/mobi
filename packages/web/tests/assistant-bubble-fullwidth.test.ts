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
 * 回归守卫：assistant 气泡贯穿整列（清 antdx Bubble 内置 15% 对侧留白）
 *
 * 背景：antdx Bubble 对 start/end 行内置 padding-inline-end/start: 15%（对侧留白），
 * assistant（start 行）内容右侧因此始终空出 ~15% 宽的一条，气泡看起来「不贯穿」。
 * d09f87ed 只删了本项目自加的 5% 对侧留白，antdx 内置 15% 仍在——2026-09-20 实测
 * computed padding-right 169px 才定位到真根因。
 *
 * 修复在 src/styles/antd.css：.ant-bubble-start 清零 padding-inline-end；
 * user 气泡（end 行）保持 antdx 默认不动。此测试防止规则被重构/升级时误删。
 */
describe('assistant 气泡贯穿守卫', () => {
    it('antd.css 清零了 .ant-bubble-start 的对侧留白（padding-inline-end）', () => {
        const css = fs.readFileSync(
            path.resolve(__dirname, '../src/styles/antd.css'),
            'utf8',
        )

        const ruleMatch = css.match(
            /\.ant-bubble-start[^{]*\{[^}]*padding-inline-end:\s*0[^}]*\}/,
        )
        expect(ruleMatch).not.toBeNull()
        expect(ruleMatch![0]).toMatch(/!important/)
    })
})
