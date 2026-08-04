import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { AskUserQuestionView } from '@/components/tool-card/views/AskUserQuestionView'
import { getToolResultViewComponent } from '@/components/tool-card/views/_results'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import type { ToolInfo } from '@/domain/tool/types'

const VIEW_SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/tool-card/views/AskUserQuestionView.tsx'),
    'utf-8'
)

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

function makeBlock(
    toolInput: unknown,
    answers?: Record<string, string[]>,
    toolName = 'AskUserQuestion',
    permissionOverride?: Partial<NonNullable<ToolInfo['permission']>>,
): ToolViewProps {
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
            ...permissionOverride,
        },
    }
    return { block: { id: 'block-1', type: 'tool_use', tool } } as ToolViewProps
}

function renderView(props: ToolViewProps) {
    return render(<AskUserQuestionView {...props} />, { wrapper })
}

function renderResultView(props: ToolViewProps) {
    const ResultView = getToolResultViewComponent('AskUserQuestion')
    return render(<ResultView {...props} />, { wrapper })
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
            renderView(props)
            // 选中项通过共享 OptionRow 渲染为 [data-selected="true"]
            const selectedBtn = screen.getByText('Bun').closest('[data-selected="true"]')
            expect(selectedBtn).toBeTruthy()
        })

        it('未选中项正常显示', () => {
            renderView(props)
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
            // OptionRow 选中态：[data-selected="true"]
            const selectedBtns = container.querySelectorAll('[data-selected="true"]')
            expect(selectedBtns.length).toBe(2)
            const labels = Array.from(selectedBtns).map(c => c.textContent)
            // Auth 和 Cache 被选中
            expect(labels.some(l => l?.includes('Auth'))).toBe(true)
            expect(labels.some(l => l?.includes('Cache'))).toBe(true)
        })

        it('未选中项不高亮', () => {
            renderView(props)
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

        it('自定义答案以 completed 选中态渲染（绿色系来自 OptionRow tone=completed）', () => {
            renderView(props)
            const denoEl = screen.getByText('deno')
            // OtherAnswersList 渲染为 OptionRow（button），绿色系由 data-tone=completed + data-selected=true 驱动
            const card = denoEl.closest('[data-testid="other-answer"]') as HTMLElement
            expect(card).toBeTruthy()
            expect(card.getAttribute('data-selected')).toBe('true')
            expect(card.getAttribute('data-tone')).toBe('completed')
        })

        it('常规选项未选中不高亮', () => {
            const { container } = renderView(props)
            // Bun 和 Node 都不在 answers 中 → 常规选项无选中态
            // （deno 经 OtherAnswersList 渲染为 checked OptionRow，需排除）
            const selectedRegular = container.querySelectorAll(
                '[data-selected="true"]:not([data-testid="other-answer"])'
            )
            expect(selectedRegular.length).toBe(0)
            // 仅 deno 通过 OtherAnswersList 渲染
            const otherCards = container.querySelectorAll('[data-testid="other-answer"]')
            expect(otherCards.length).toBe(1)
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

        it('自由格式答案以 completed 选中态渲染（绿色系来自 OptionRow tone=completed）', () => {
            renderView(props)
            const answerEl = screen.getByText('I prefer TDD with incremental refactoring')
            // FreeformAnswersList 渲染为 OptionRow（button），绿色系由 data-tone=completed + data-selected=true 驱动
            const card = answerEl.closest('[data-testid="freeform-answer"]') as HTMLElement
            expect(card).toBeTruthy()
            expect(card.getAttribute('data-selected')).toBe('true')
            expect(card.getAttribute('data-tone')).toBe('completed')
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
            // 无选中 OptionRow，也无 other/freeform 答案卡片
            const selectedBtns = container.querySelectorAll('[data-selected="true"]')
            expect(selectedBtns.length).toBe(0)
            const otherCards = container.querySelectorAll('[data-testid="other-answer"]')
            expect(otherCards.length).toBe(0)
        })
    })

    describe('TC-25: token 化完成态', () => {
        // jsdom 把 hex 序列化为 rgb，故 HTML 断言无法区分「硬编码 hex」与「token 求值」。
        // 源码级断言才真正锚定根除硬编码 — 与任务要求的 grep 验证等价。
        // 注意：下列字面量出现在源码任意位置（含注释）都会失败，这是故意的，强制零硬编码。
        it('源码不再含硬编码绿色 hex 字面量（#52c41a / #f6ffed / #237804 / #999）', () => {
            expect(VIEW_SRC).not.toContain('#52c41a')
            expect(VIEW_SRC).not.toContain('#f6ffed')
            expect(VIEW_SRC).not.toContain('#237804')
            expect(VIEW_SRC).not.toContain('#999')
        })

        it('完成态使用共享 OptionRow（tone="completed"）渲染选项', () => {
            expect(VIEW_SRC).toContain("tone=\"completed\"")
            expect(VIEW_SRC).toMatch(/from '\.\.\/OptionRow'/)
        })

        it('完成态渲染 HTML 不出现默认成功色 hex 字面量（jsdom 转 rgb 后仍应消失）', () => {
            // 一道题 + 一个选中选项 + 一个自定义答案，覆盖 option 与 other-answer 两条渲染路径
            const props = makeBlock(
                { questions: [{
                    question: 'Which?',
                    header: 'Lang',
                    options: [
                        { label: 'A', description: 'pick A' },
                        { label: 'B', description: 'pick B' },
                    ],
                    multiSelect: false,
                }]},
                { 'Which?': ['A', 'deno'] }
            )
            const { container } = renderView(props)
            // jsdom 把 hex 序列化为 rgb — 这是双保险，验证渲染层也无残留
            expect(container.innerHTML).not.toContain('#52c41a')
            expect(container.innerHTML).not.toContain('#f6ffed')
            expect(container.innerHTML).not.toContain('#237804')
            expect(container.innerHTML).not.toContain('#999')
        })

        it('自由格式答案路径也不含硬编码绿色 hex 字面量', () => {
            // 无选项的问题 + 自由格式答案，覆盖 freeform 渲染路径
            const props = makeBlock(
                { questions: [{
                    question: 'Describe',
                    header: 'Approach',
                    options: [],
                    multiSelect: false,
                }]},
                { 'Describe': ['I prefer TDD'] }
            )
            const { container } = renderView(props)
            expect(container.innerHTML).not.toContain('#52c41a')
            expect(container.innerHTML).not.toContain('#f6ffed')
            expect(container.innerHTML).not.toContain('#237804')
            expect(container.innerHTML).not.toContain('#999')
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
            // OptionRow 选中态：[data-selected="true"]，每题一个
            const selectedBtns = container.querySelectorAll('[data-selected="true"]')
            expect(selectedBtns.length).toBe(2)
        })
    })

    describe('denied 态渲染拒绝原因', () => {
        const questionInput = { questions: [{ question: 'Q?', options: [], multiSelect: false }] }

        it('permission.decision=abort + reason → 展示拒绝原因（聊一聊 seed 文案）', () => {
            const block = makeBlock(questionInput, undefined, 'AskUserQuestion', {
                id: 'p1', status: 'denied', decision: 'abort',
                reason: 'The user wants to clarify these questions.',
            })
            renderResultView(block)
            expect(screen.getByText(/The user wants to clarify these questions/)).toBeInTheDocument()
        })

        it('permission.status=denied + reason（无 decision）→ 同样展示 reason', () => {
            const block = makeBlock(questionInput, undefined, 'AskUserQuestion', {
                id: 'p2', status: 'denied', reason: 'No answers were provided.',
            })
            renderResultView(block)
            expect(screen.getByText(/No answers were provided/)).toBeInTheDocument()
        })

        it('permission.status=denied 无 reason → 兜底文案 chat.tool.rejected', () => {
            const block = makeBlock(questionInput, undefined, 'AskUserQuestion', {
                id: 'p3', status: 'denied',
            })
            renderResultView(block)
            // mock t('chat.tool.rejected') 直接返回 key 字符串
            expect(screen.getByText('chat.tool.rejected')).toBeInTheDocument()
        })

        it('status=canceled 不走 denied 分支（reason 不被当作拒绝原因展示）', () => {
            const block = makeBlock(questionInput, undefined, 'AskUserQuestion', {
                id: 'p4', status: 'canceled', reason: 'some unexpected reason',
            })
            renderResultView(block)
            expect(screen.queryByText(/some unexpected reason/)).toBeNull()
        })
    })
})
