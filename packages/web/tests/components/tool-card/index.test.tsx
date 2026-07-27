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

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { ToolCard } from '@/components/tool-card'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { MobiApi } from '@/core/data/api/client'

// mock i18next（保留 initReactI18next 等真实导出，仅替换 useTranslation）
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                const map: Record<string, string> = {
                    'chat.tool.waitingForApproval': '等待审批...',
                    'chat.tool.input': '输入',
                    'chat.tool.result': '结果',
                    'chat.tool.questionsAnswers': '问答',
                }
                return map[key] ?? key
            },
        }),
    }
})

// jsdom 没有 ResizeObserver（Ant Design 部分组件需要）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

afterEach(cleanup)

const mockApi = {
    permissions: { approve: vi.fn(), deny: vi.fn() },
} as unknown as MobiApi

function makeBlock(overrides: Partial<ToolCallBlock['tool']> = {}): ToolCallBlock {
    return {
        id: 'block-1',
        kind: 'tool-call',
        children: [],
        tool: {
            name: 'Bash',
            input: { command: 'echo hi' },
            result: undefined,
            state: 'running',
            description: null,
            startedAt: null,
            createdAt: Date.now(),
            permission: { id: 'p1', status: 'pending' },
            ...overrides,
        },
    } as ToolCallBlock
}

function renderCard(block: ToolCallBlock) {
    return render(
        <ConfigProvider>
            <ToolCard
                api={mockApi}
                sessionId="s1"
                metadata={null}
                disabled={false}
                onDone={vi.fn()}
                block={block}
            />
        </ConfigProvider>
    )
}

describe('ToolCard pending 焦点层', () => {
    it('pending 时容器带 data-pending=true 与焦点色带节点', () => {
        renderCard(makeBlock())
        const card = document.querySelector('.tool-card') as HTMLElement
        expect(card.getAttribute('data-pending')).toBe('true')
        expect(card.querySelector('[data-slot="focus-bar"]')).not.toBeNull()
    })

    it('pending 时显示等待徽章', () => {
        renderCard(makeBlock())
        expect(screen.getByTestId('pending-badge')).toBeInTheDocument()
    })

    it('非 pending 时不带 data-pending=true', () => {
        renderCard(makeBlock({ permission: null, state: 'completed' }))
        const card = document.querySelector('.tool-card') as HTMLElement
        expect(card.getAttribute('data-pending')).toBe('false')
        expect(card.querySelector('[data-slot="focus-bar"]')).toBeNull()
    })

    it('pending 时点击 header 不打开 Modal', () => {
        renderCard(makeBlock())
        fireEvent.click(screen.getByTestId('tool-card-header'))
        expect(document.querySelector('.ant-modal-content')).toBeNull()
    })
})
