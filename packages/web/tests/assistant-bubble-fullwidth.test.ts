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

import { describe, it, expect } from 'vitest'
import { BUBBLE_ROLES } from '@/components/chat/bubbleRoles'

/**
 * 回归守卫：assistant 气泡贯穿整列（清 antdx Bubble 内置 15% 对侧留白）
 *
 * 背景：antdx Bubble 对 start 行内置 padding-inline-end: 15%（对侧留白），
 * assistant 气泡内容右侧因此始终空出 ~15% 宽的一条，看起来「不贯穿」。
 * d09f87ed 只删了本项目自加的 5%，antdx 内置 15% 仍在——2026-09-20 实测
 * computed padding-right 169px 才定位到真根因。
 *
 * 修复在 BUBBLE_ROLES.assistant 的 styles.root（antdx 语义槽位，内联样式
 * 胜过库规则且作用域精确到角色；Drawer 经展开自动一致，无全局 CSS 泄漏）。
 * 此测试防止该配置被重构时误删——断言配置行为，不匹配 CSS 文本。
 */
describe('assistant 气泡贯穿守卫', () => {
    it('assistant 角色 root 清零对侧留白（paddingInlineEnd = 0）', () => {
        expect(BUBBLE_ROLES.assistant.styles?.root?.paddingInlineEnd).toBe(0)
    })

    it('user 角色保持库默认（不动对侧留白，维持右对齐视觉）', () => {
        expect(BUBBLE_ROLES.user.styles).toBeUndefined()
    })
})
