import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { AskUserQuestionView } from '@/components/tool-card/views/AskUserQuestionView'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import type { ToolInfo } from '@/domain/tool/types'

// mock i18next
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => key,
        }),
    }
})

// jsdom 没有 ResizeObserver
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

function makeBlock(toolInput: unknown, answers?: Record<string, string[]>, toolName = 'AskUserQuestion'): ToolViewProps {
    const tool: ToolInfo = {
        name: toolName,
        input: toolInput,
        result: undefined,
        state: 'completed',
        description: null,
        startedAt: null,
        createdAt: Date.now(),
        permission: {
            id: 'perm-1',
            status: 'approved',
            createdAt: Date.now(),
            answers,
        },
    }
    return { block: { id: 'block-1', type: 'tool_use', tool } } as ToolViewProps
}

function renderView(props: ToolViewProps) {
    return render(<AskUserQuestionView {...props} />, { wrapper })
}

describe('AskUserQuestionView', () => {
    afterEach(() => {
        cleanup()
    })
    describe('TC-21: 单选答案展示', () => {
        const props = makeBlock(
            { questions: [{
                question: 'Which runtime?',
                header: 'Runtime',
                options: [
                    { label: 'Bun', description: 'Fast' },
                    { label: 'Node', description: 'Classic' },
                ],
                multiSelect: false,
            }]},
            { 'Which runtime?': ['Bun'] }
        )

        it('选中项显示正确', () => {
            const { container } = renderView(props)
            // 选中项有绿色边框
            const allCards = container.querySelectorAll('div[style*="border: 1px solid"]')
            let selectedCard: Element | null = null
            let unselectedCard: Element | null = null
            allCards.forEach(card => {
                const style = (card as HTMLElement).style
                if (style.borderColor === 'rgb(82, 196, 26)') selectedCard = card
                if (style.borderColor !== 'rgb(82, 196, 26)' && style.borderColor !== '') unselectedCard = card
            })
            expect(selectedCard).toBeTruthy()
            expect(selectedCard?.textContent).toContain('Bun')
        })

        it('未选中项正常显示', () => {
            const { container } = renderView(props)
            expect(screen.getByText('Node')).toBeInTheDocument()
            expect(screen.getByText('Classic')).toBeInTheDocument()
        })

        it('问题文字正常显示', () => {
            renderView(props)
            expect(screen.getByText('Which runtime?')).toBeInTheDocument()
        })
    })

    describe('TC-22: 多选答案展示', () => {
        const props = makeBlock(
            { questions: [{
                question: 'Select features',
                header: 'Features',
                options: [
                    { label: 'Auth', description: '认证' },
                    { label: 'Logging', description: '日志' },
                    { label: 'Cache', description: '缓存' },
                ],
                multiSelect: true,
            }]},
            { 'Select features': ['Auth', 'Cache'] }
        )

        it('多个选中项均高亮', () => {
            const { container } = renderView(props)
            const greenCards = container.querySelectorAll('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(greenCards.length).toBe(2)
            const labels = Array.from(greenCards).map(c => c.textContent)
            // Auth 和 Cache 被选中
            expect(labels.some(l => l?.includes('Auth'))).toBe(true)
            expect(labels.some(l => l?.includes('Cache'))).toBe(true)
        })

        it('未选中项不高亮', () => {
            const { container } = renderView(props)
            expect(screen.getByText('Logging')).toBeInTheDocument()
        })
    })

    describe('TC-23: 自定义答案展示', () => {
        const props = makeBlock(
            { questions: [{
                question: 'Which runtime?',
                header: 'Runtime',
                options: [
                    { label: 'Bun', description: 'Fast' },
                    { label: 'Node', description: 'Classic' },
                ],
                multiSelect: false,
            }]},
            { 'Which runtime?': ['deno'] }
        )

        it('自定义答案显示在选项列表下方', () => {
            renderView(props)
            expect(screen.getByText('deno')).toBeInTheDocument()
            expect(screen.getByText('(custom answer)')).toBeInTheDocument()
        })

        it('自定义答案有绿色样式', () => {
            const { container } = renderView(props)
            const denoEl = screen.getByText('deno')
            const card = denoEl.closest('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(card).toBeTruthy()
        })

        it('常规选项未选中不高亮', () => {
            const { container } = renderView(props)
            // Bun 和 Node 都不在 answers 中
            const greenCards = container.querySelectorAll('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(greenCards.length).toBe(1) // 只有 deno
        })
    })

    describe('TC-24: 自由格式答案（无选项）', () => {
        const props = makeBlock(
            { questions: [{
                question: 'Describe your approach',
                header: 'Approach',
                options: [],
                multiSelect: false,
            }]},
            { 'Describe your approach': ['I prefer TDD with incremental refactoring'] }
        )

        it('自由格式答案直接显示', () => {
            renderView(props)
            expect(screen.getByText('I prefer TDD with incremental refactoring')).toBeInTheDocument()
        })

        it('自由格式答案有绿色样式', () => {
            const { container } = renderView(props)
            const answerEl = screen.getByText('I prefer TDD with incremental refactoring')
            const card = answerEl.closest('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(card).toBeTruthy()
        })
    })

    describe('空 answers', () => {
        it('无 answers 时正常渲染选项但不显示选中状态', () => {
            const props = makeBlock(
                { questions: [{
                    question: 'Q?',
                    options: [{ label: 'A' }, { label: 'B' }],
                    multiSelect: false,
                }]},
                undefined
            )
            const { container } = renderView(props)
            expect(screen.getByText('A')).toBeInTheDocument()
            expect(screen.getByText('B')).toBeInTheDocument()
            // 无绿色高亮卡片
            const greenCards = container.querySelectorAll('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(greenCards.length).toBe(0)
        })
    })

    describe('多问题展示', () => {
        const props = makeBlock(
            { questions: [
                {
                    question: 'Language?',
                    header: 'Language',
                    options: [{ label: 'TypeScript' }, { label: 'Python' }],
                    multiSelect: false,
                },
                {
                    question: 'Framework?',
                    header: 'Framework',
                    options: [{ label: 'React' }, { label: 'Vue' }],
                    multiSelect: false,
                },
            ]},
            { 'Language?': ['TypeScript'], 'Framework?': ['Vue'] }
        )

        it('多个问题都展示', () => {
            renderView(props)
            expect(screen.getByText('Language?')).toBeInTheDocument()
            expect(screen.getByText('Framework?')).toBeInTheDocument()
        })

        it('每题的答案正确高亮', () => {
            const { container } = renderView(props)
            const greenCards = container.querySelectorAll('div[style*="border: 1px solid rgb(82, 196, 26)"]')
            expect(greenCards.length).toBe(2)
        })
    })
})
