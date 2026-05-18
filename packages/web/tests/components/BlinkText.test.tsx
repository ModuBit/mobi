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
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { BlinkText } from '@/components/ui/BlinkText'

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('BlinkText', () => {
    it('blinking=false 时渲染普通 span', () => {
        render(<BlinkText blinking={false}>Hello</BlinkText>, { wrapper })
        const el = screen.getByText('Hello')
        expect(el.tagName).toBe('SPAN')
        // 不应有动画相关样式
        expect(el.style.animation).toBe('')
    })

    it('blinking=true 时应用光泽动画样式', () => {
        render(
            <BlinkText blinking color="#e8825c">
                Working
            </BlinkText>,
            { wrapper },
        )
        const el = screen.getByText('Working')
        // motion.span 渲染为 span 元素
        expect(el.tagName).toBe('SPAN')
        const style = getComputedStyle(el)
        // 应使用 text 渐变裁剪实现光泽效果
        expect(style.backgroundClip).toContain('text')
    })

    it('支持自定义 className 和 style', () => {
        render(
            <BlinkText
                blinking={false}
                className="custom"
                style={{ fontSize: 14 }}
            >
                Text
            </BlinkText>,
            { wrapper },
        )
        const el = screen.getByText('Text')
        expect(el.className).toContain('custom')
        expect(el.style.fontSize).toBe('14px')
    })
})
