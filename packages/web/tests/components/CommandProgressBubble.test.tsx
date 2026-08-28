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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { CommandProgressBubble } from '@/components/chat/CommandProgressBubble'

// mock i18next：提供命令进度文案映射
// initReactI18next 必须 noop 导出 —— 同 SessionCreating.test，避免 i18n 顶层 init 报错
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.compacting': '正在压缩对话…',
                'chat.clearing': '正在清空上下文…',
            }
            return map[key] ?? key
        },
    }),
}))

// 测试用占位图标已随 icon prop 移除：进度 bubble 的左侧视觉统一为 MobiLogo 品牌动画

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('CommandProgressBubble', () => {
    // vitest 未开 globals，需显式 cleanup（见 project_web-test-cleanup-explicit）
    afterEach(cleanup)

    it('渲染 MobiLogo 品牌动画与文案', () => {
        const { container } = render(<CommandProgressBubble titleKey="chat.compacting" />, { wrapper })
        expect(screen.getByText('正在压缩对话…')).toBeInTheDocument()
        // MobiLogo：250×250 viewBox 品牌动画 svg
        //（不用 svg[viewBox=...] 选择器——jsdom 选择器引擎对 camelCase attribute 名匹配不可靠）
        const svg = container.querySelector('svg')
        expect(svg).toHaveAttribute('viewBox', '0 0 250 250')
    })

    it('titleKey 切换驱动文案（compact vs clear）', () => {
        const { rerender } = render(<CommandProgressBubble titleKey="chat.compacting" />, { wrapper })
        expect(screen.getByText('正在压缩对话…')).toBeInTheDocument()

        rerender(<CommandProgressBubble titleKey="chat.clearing" />)
        expect(screen.getByText('正在清空上下文…')).toBeInTheDocument()
        expect(screen.queryByText('正在压缩对话…')).not.toBeInTheDocument()
    })

    it('文案容器具备 role=status 可访问性', () => {
        render(<CommandProgressBubble titleKey="chat.clearing" />, { wrapper })
        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('正在清空上下文')
        expect(status).toHaveAttribute('aria-live', 'polite')
    })
})
