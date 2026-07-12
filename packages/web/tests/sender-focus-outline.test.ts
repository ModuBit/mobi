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
 * 回归守卫：Sender 输入框 focus 黑框
 *
 * 背景：antd-x Sender 内部 textarea 是 antd Input 的 borderless 变体。
 * antd Input 的 :focus { outline:0 } 只写在 outlined/filled 变体上，
 * borderless 没有 → focus 时暴露浏览器 UA 默认 textarea:focus outline（一圈黑框）。
 * 该问题由 antd 6.4.4→6.5.0 / @ant-design/x 2.7.0→2.8.0 升级引入。
 *
 * 修复在 src/styles/antd.css：给 .ant-sender 内 .ant-input 显式补 focus outline reset。
 * 此测试防止该规则被重构/升级时误删。
 */
describe('Sender focus outline 修复守卫', () => {
    it('antd.css 为 .ant-sender 内 textarea 补了 focus outline reset', () => {
        const css = fs.readFileSync(
            path.resolve(__dirname, '../src/styles/antd.css'),
            'utf8',
        )

        // 必须存在针对 Sender 内 input 的 :focus 规则
        expect(css).toMatch(/\.ant-sender\b[^{]*\.ant-input[^{]*:focus/)
        // 且该规则 reset 了 outline
        const ruleMatch = css.match(
            /\.ant-sender\b[^{]*\.ant-input[^{]*:focus[^{]*\{[^}]*\}/,
        )
        expect(ruleMatch).not.toBeNull()
        expect(ruleMatch![0]).toMatch(/outline:\s*none/)
    })
})
