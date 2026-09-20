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

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { Bubble } from '@ant-design/x'
import { BUBBLE_ROLES } from '@/components/chat/bubbleRoles'

/**
 * 回归守卫：assistant 气泡贯穿整列（清 antdx Bubble 内置 15% 对侧留白）
 *
 * 背景：antdx Bubble 对 start 行内置 padding-inline-end: 15%（对侧留白），
 * assistant 气泡内容右侧因此始终空出 ~15% 宽的一条，看起来「不贯穿」。
 * d09f87ed 只删了本项目自加的 5%，antdx 内置 15% 仍在——2026-09-20 实测
 * computed padding-right 169px 才定位到真根因。
 *
 * 修复在 BUBBLE_ROLES.assistant 的 styles.root。本测试渲染真实 Bubble 断言
 * 内联样式落到根元素——能捕获 antdx 升级后 slot 改名 / styles 不再落到
 * `.ant-bubble` 根元素等「配置还在但机制断了」的回归（复述配置的同义反复测不到）。
 */
describe('assistant 气泡贯穿守卫', () => {
    afterEach(cleanup)

    const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider>{children}</ConfigProvider>

    it('styles.root 的 paddingInlineEnd=0 落到气泡根元素（内联样式胜过库 15% 规则）', () => {
        const { container } = render(
            <Bubble {...BUBBLE_ROLES.assistant} content="hello" />,
            { wrapper },
        )
        const root = container.querySelector('.ant-bubble')
        expect(root).not.toBeNull()
        // jsdom 反映内联样式：若 antdx 改了 root slot 语义，这里会断
        expect(root!.style.paddingInlineEnd).toBe('0px')
    })

    it('user 角色无 styles（保持库默认对侧留白，维持右对齐视觉）', () => {
        expect(BUBBLE_ROLES.user.styles).toBeUndefined()
    })
})
