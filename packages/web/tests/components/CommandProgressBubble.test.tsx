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
// initReactI18next 必须 noop 导出 —— 同 SessionSpawnPending.test，避免 i18n 顶层 init 报错
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

// 测试用占位图标（data-testid 便于断言），不依赖 antd icon 库
const TestIcon = () => <svg data-testid="cmd-icon" />

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('CommandProgressBubble', () => {
    // vitest 未开 globals，需显式 cleanup（见 project_web-test-cleanup-explicit）
    afterEach(cleanup)

    it('渲染图标与文案', () => {
        render(<CommandProgressBubble icon={<TestIcon />} titleKey="chat.compacting" />, { wrapper })
        expect(screen.getByText('正在压缩对话…')).toBeInTheDocument()
        expect(screen.getByTestId('cmd-icon')).toBeInTheDocument()
    })

    it('titleKey 切换驱动文案（compact vs clear）', () => {
        const { rerender } = render(<CommandProgressBubble icon={<TestIcon />} titleKey="chat.compacting" />, { wrapper })
        expect(screen.getByText('正在压缩对话…')).toBeInTheDocument()

        rerender(<CommandProgressBubble icon={<TestIcon />} titleKey="chat.clearing" />)
        expect(screen.getByText('正在清空上下文…')).toBeInTheDocument()
        expect(screen.queryByText('正在压缩对话…')).not.toBeInTheDocument()
    })

    it('文案容器具备 role=status 可访问性', () => {
        render(<CommandProgressBubble icon={<TestIcon />} titleKey="chat.clearing" />, { wrapper })
        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('正在清空上下文')
        expect(status).toHaveAttribute('aria-live', 'polite')
    })
})
