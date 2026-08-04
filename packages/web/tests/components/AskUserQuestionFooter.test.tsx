import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AskUserQuestionFooter } from '@/components/tool-card/AskUserQuestionFooter'
import type { ToolInfo } from '@/domain/tool/types'
import type { MobiApi } from '@/core/data/api/client'

// mock i18next
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string, params?: Record<string, unknown>) => {
                const map: Record<string, string> = {
                    'chat.tool.selectOption': '请选择一个选项',
                    'chat.tool.requestFailed': '请求失败',
                    'chat.tool.other': '其他',
                    'chat.tool.otherDescription': '选择此项以输入自定义答案',
                    'chat.tool.askUserQuestion.otherPlaceholder': '请输入自定义答案...',
                    'chat.tool.askUserQuestion.fallback': '请输入您的回答',
                    'chat.tool.askUserQuestion.placeholder': '在此输入...',
                    'chat.tool.askUserQuestion.questionN': `第 ${params?.n ?? '?'} 题`,
                    'chat.tool.askUserQuestion.title': '问题',
                    'chat.tool.submit': '提交',
                    'chat.tool.submitting': '提交中...',
                    'chat.tool.askUserQuestion.chatAbout': '聊一聊',
                }
                return map[key] ?? key
            },
        }),
    }
})

// mock useIsMobile：默认移动端（触控目标 44px）
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => true,
}))

const mockApprove = vi.fn()
const mockDeny = vi.fn()
const mockApi = {
    permissions: { approve: mockApprove, deny: mockDeny },
} as unknown as MobiApi

// jsdom 没有 ResizeObserver（Ant Design TextArea 需要）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const wrapper = ({ children }: { children: React.ReactNode }) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return (
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>{children}</ConfigProvider>
        </QueryClientProvider>
    )
}

function makeTool(questions: unknown[], toolName = 'AskUserQuestion'): ToolInfo {
    return {
        name: toolName,
        input: { questions },
        result: undefined,
        state: 'running',
        description: null,
        startedAt: null,
        createdAt: Date.now(),
        permission: {
            id: 'perm-1',
            status: 'pending',
            createdAt: Date.now(),
        },
    }
}

function renderFooter(tool: ToolInfo, disabled = false) {
    return render(
        <AskUserQuestionFooter
            api={mockApi}
            sessionId="session-1"
            tool={tool}
            disabled={disabled}
            onDone={vi.fn()}
        />,
        { wrapper }
    )
}

/** 查找选项按钮（共享 OptionRow 渲染的 <button data-selected>），通过其内部 label div 匹配 */
function findOptionBtn(label: string): HTMLElement {
    const opts = Array.from(document.querySelectorAll('[data-selected]'))
    for (const o of opts) {
        const title = o.querySelector('span > div:first-child')
        if (title && title.textContent?.trim() === label) return o as HTMLElement
    }
    throw new Error(`option "${label}" not found`)
}

/** 查找提交按钮 */
function getSubmitButton(): HTMLElement {
    // Ant Design Button 的文本可能包含 "提交" 或 "提交中..."
    const btns = Array.from(document.querySelectorAll('button'))
    // 优先找 ant-btn
    for (const btn of btns) {
        const text = btn.textContent ?? ''
        if (text.includes('提交') && !text.includes('中') &&
            btn.classList.contains('ant-btn')) {
            return btn as HTMLElement
        }
    }
    // 兜底：找文本包含"提交"且不是选项按钮的
    for (const btn of btns) {
        const text = btn.textContent ?? ''
        if (text === '提交') {
            // 排除选项按钮（选项按钮内还有 description）
            const labelDiv = btn.querySelector('span > div')
            if (!labelDiv || labelDiv.textContent?.trim() !== '提交') {
                return btn as HTMLElement
            }
        }
    }
    throw new Error('Submit button not found. Buttons: ' +
        btns.map(b => `class="${b.className}" text="${b.textContent?.trim()?.slice(0, 20)}"`).join(' | '))
}

describe('AskUserQuestionFooter', () => {
    beforeEach(() => {
        mockApprove.mockReset()
        mockDeny.mockReset()
    })

    afterEach(() => {
        cleanup()
    })

    describe('单选模式', () => {
        const singleSelectTool = makeTool([{
            question: 'Which runtime?',
            header: 'Runtime',
            options: [
                { label: 'Bun', description: 'Fast' },
                { label: 'Node', description: 'Classic' },
            ],
            multiSelect: false,
        }])

        it('渲染所有选项和提交按钮', () => {
            renderFooter(singleSelectTool)
            expect(findOptionBtn('Bun')).toBeInTheDocument()
            expect(findOptionBtn('Node')).toBeInTheDocument()
            expect(screen.getByText('Fast')).toBeInTheDocument()
            expect(getSubmitButton()).toBeInTheDocument()
        })

        it('未选择时提交按钮禁用', () => {
            renderFooter(singleSelectTool)
            expect(getSubmitButton()).toBeDisabled()
        })

        it('点击选项后提交按钮启用', () => {
            renderFooter(singleSelectTool)
            fireEvent.click(findOptionBtn('Bun'))
            expect(getSubmitButton()).not.toBeDisabled()
        })

        it('单选模式下选项互斥', () => {
            renderFooter(singleSelectTool)
            fireEvent.click(findOptionBtn('Bun'))
            fireEvent.click(findOptionBtn('Node'))
            expect(getSubmitButton()).not.toBeDisabled()
        })

        it('提交后调用 approve API', async () => {
            mockApprove.mockResolvedValue(undefined)
            const onDone = vi.fn()
            render(
                <AskUserQuestionFooter
                    api={mockApi}
                    sessionId="session-1"
                    tool={singleSelectTool}
                    disabled={false}
                    onDone={onDone}
                />,
                { wrapper }
            )

            fireEvent.click(findOptionBtn('Bun'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(mockApprove).toHaveBeenCalledWith('session-1', 'perm-1', {
                    answers: { 'Which runtime?': ['Bun'] }
                })
            })
            expect(onDone).toHaveBeenCalled()
        })
    })

    describe('多选模式', () => {
        const multiSelectTool = makeTool([{
            question: 'Select features',
            header: 'Features',
            options: [
                { label: 'Auth', description: '认证' },
                { label: 'Logging', description: '日志' },
                { label: 'Cache', description: '缓存' },
            ],
            multiSelect: true,
        }])

        it('可以同时选中多个选项', () => {
            renderFooter(multiSelectTool)
            fireEvent.click(findOptionBtn('Auth'))
            fireEvent.click(findOptionBtn('Cache'))
            expect(getSubmitButton()).not.toBeDisabled()
        })

        it('再次点击已选项可取消', () => {
            renderFooter(multiSelectTool)
            fireEvent.click(findOptionBtn('Auth'))
            fireEvent.click(findOptionBtn('Auth'))
            expect(getSubmitButton()).toBeDisabled()
        })

        it('提交多选答案', async () => {
            mockApprove.mockResolvedValue(undefined)
            renderFooter(multiSelectTool)

            fireEvent.click(findOptionBtn('Auth'))
            fireEvent.click(findOptionBtn('Logging'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(mockApprove).toHaveBeenCalledWith('session-1', 'perm-1', {
                    answers: { 'Select features': ['Auth', 'Logging'] }
                })
            })
        })
    })

    describe('TC-07: 跳题校验', () => {
        const tool = makeTool([
            {
                question: 'Q1?',
                header: 'H1',
                options: [{ label: 'A1' }, { label: 'B1' }],
                multiSelect: false,
            },
            {
                question: 'Q2?',
                header: 'H2',
                options: [{ label: 'C2' }, { label: 'D2' }],
                multiSelect: false,
            },
        ])

        it('多题模式未全答时提交禁用', () => {
            renderFooter(tool)
            // 只选第一题
            fireEvent.click(findOptionBtn('A1'))
            // 切到最后一题 tab（Submit 只在最后一题显示）
            fireEvent.click(screen.getByRole('tab', { name: 'H2' }))
            // 第二题未答，Submit 应禁用
            expect(getSubmitButton()).toBeDisabled()
        })

        it('回答所有题后提交启用', () => {
            renderFooter(tool)
            fireEvent.click(findOptionBtn('A1'))
            const tab2 = screen.getByRole('tab', { name: 'H2' })
            fireEvent.click(tab2)
            fireEvent.click(findOptionBtn('C2'))
            expect(getSubmitButton()).not.toBeDisabled()
        })
    })

    describe('TC-10: Other 取消选中', () => {
        const singleTool = makeTool([{
            question: 'Color?',
            header: 'Color',
            options: [{ label: 'Red' }, { label: 'Blue' }],
            multiSelect: false,
        }])

        const multiTool = makeTool([{
            question: 'Langs?',
            header: 'Langs',
            options: [{ label: 'TS' }, { label: 'Python' }],
            multiSelect: true,
        }])

        it('单选模式下 Other 可以 toggle off', () => {
            renderFooter(singleTool)
            const otherBtn = findOptionBtn('其他')
            fireEvent.click(otherBtn)
            expect(screen.getByPlaceholderText('请输入自定义答案...')).toBeInTheDocument()
            fireEvent.click(otherBtn)
            expect(screen.queryByPlaceholderText('请输入自定义答案...')).not.toBeInTheDocument()
        })

        it('多选模式下 Other 可以 toggle off', () => {
            renderFooter(multiTool)
            const otherBtn = findOptionBtn('其他')
            fireEvent.click(otherBtn)
            expect(screen.getByPlaceholderText('请输入自定义答案...')).toBeInTheDocument()
            fireEvent.click(otherBtn)
            expect(screen.queryByPlaceholderText('请输入自定义答案...')).not.toBeInTheDocument()
        })

        it('单选模式下 Other 与常规选项互斥', () => {
            renderFooter(singleTool)
            fireEvent.click(findOptionBtn('Red'))
            fireEvent.click(findOptionBtn('其他'))
            expect(getSubmitButton()).toBeDisabled()
        })

        it('单选模式下选常规选项时取消 Other', () => {
            renderFooter(singleTool)
            fireEvent.click(findOptionBtn('其他'))
            expect(screen.getByPlaceholderText('请输入自定义答案...')).toBeInTheDocument()
            fireEvent.click(findOptionBtn('Red'))
            expect(screen.queryByPlaceholderText('请输入自定义答案...')).not.toBeInTheDocument()
            expect(getSubmitButton()).not.toBeDisabled()
        })
    })

    describe('TC-11: Other 空文本', () => {
        const singleTool = makeTool([{
            question: 'PM?',
            header: 'PM',
            options: [{ label: 'npm' }, { label: 'bun' }],
            multiSelect: false,
        }])

        const multiTool = makeTool([{
            question: 'Langs?',
            header: 'Langs',
            options: [{ label: 'TS' }, { label: 'Go' }],
            multiSelect: true,
        }])

        it('单选模式下选中 Other 但不输入文字，提交禁用', () => {
            renderFooter(singleTool)
            fireEvent.click(findOptionBtn('其他'))
            expect(getSubmitButton()).toBeDisabled()
        })

        it('单选模式下输入文字后提交启用', () => {
            renderFooter(singleTool)
            fireEvent.click(findOptionBtn('其他'))
            const input = screen.getByPlaceholderText('请输入自定义答案...')
            fireEvent.change(input, { target: { value: 'deno' } })
            expect(getSubmitButton()).not.toBeDisabled()
        })

        it('多选模式下选中空 Other + 常规选项，提交时静默忽略空 Other', async () => {
            mockApprove.mockResolvedValue(undefined)
            renderFooter(multiTool)
            fireEvent.click(findOptionBtn('其他'))
            fireEvent.click(findOptionBtn('TS'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(mockApprove).toHaveBeenCalledWith('session-1', 'perm-1', {
                    answers: { 'Langs?': ['TS'] }
                })
            })
        })

        it('多选模式下仅选中空 Other，提交禁用', () => {
            renderFooter(multiTool)
            fireEvent.click(findOptionBtn('其他'))
            expect(getSubmitButton()).toBeDisabled()
        })
    })

    describe('TC-12: 空问题 fallback', () => {
        it('显示 fallback 文本框、空文本时禁用、输入后可提交', async () => {
            mockApprove.mockResolvedValue(undefined)
            renderFooter(makeTool([]))

            // 显示 fallback 文本框
            expect(screen.getByText('请输入您的回答')).toBeInTheDocument()
            const input = screen.getByPlaceholderText('在此输入...')
            expect(input).toBeInTheDocument()

            // 空文本时提交禁用
            expect(getSubmitButton()).toBeDisabled()

            // 输入文字后提交启用
            fireEvent.change(input, { target: { value: 'my answer' } })
            expect(getSubmitButton()).not.toBeDisabled()

            // 提交
            fireEvent.click(getSubmitButton())
            await waitFor(() => {
                expect(mockApprove).toHaveBeenCalledWith('session-1', 'perm-1', {
                    answers: { '': ['my answer'] }
                })
            })
        })
    })

    describe('TC-17: 提交 loading 状态', () => {
        it('提交中选项不可点击', async () => {
            let resolveApprove!: () => void
            mockApprove.mockReturnValue(new Promise<void>((r) => { resolveApprove = r }))

            const tool = makeTool([{
                question: 'Q?',
                header: 'H',
                options: [{ label: 'OptA' }],
                multiSelect: false,
            }])

            renderFooter(tool)
            fireEvent.click(findOptionBtn('OptA'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(findOptionBtn('OptA')).toHaveAttribute('aria-disabled', 'true')
            })

            resolveApprove()
        })
    })

    describe('TC-18: 提交失败错误处理', () => {
        it('提交失败时显示错误信息', async () => {
            mockApprove.mockRejectedValue(new Error('网络错误'))

            const tool = makeTool([{
                question: 'Q?',
                header: 'H',
                options: [{ label: 'OptA' }],
                multiSelect: false,
            }])

            renderFooter(tool)
            fireEvent.click(findOptionBtn('OptA'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(screen.getByText('网络错误')).toBeInTheDocument()
            })
        })

        it('错误后选择保留、可重新提交', async () => {
            mockApprove.mockRejectedValue(new Error('网络错误'))

            const tool = makeTool([{
                question: 'Q?',
                header: 'H',
                options: [{ label: 'OptA' }],
                multiSelect: false,
            }])

            renderFooter(tool)
            fireEvent.click(findOptionBtn('OptA'))
            fireEvent.click(getSubmitButton())

            // 等待错误出现
            await waitFor(() => {
                expect(screen.getByText('网络错误')).toBeInTheDocument()
            })

            // 选择状态保留（OptA 仍在，提交按钮仍可用）
            expect(findOptionBtn('OptA')).toBeInTheDocument()
            expect(getSubmitButton()).not.toBeDisabled()
        })

        it('非 Error 对象时显示兜底错误文案', async () => {
            mockApprove.mockRejectedValue('unknown error')

            const tool = makeTool([{
                question: 'Q?',
                header: 'H',
                options: [{ label: 'OptA' }],
                multiSelect: false,
            }])

            renderFooter(tool)
            fireEvent.click(findOptionBtn('OptA'))
            fireEvent.click(getSubmitButton())

            await waitFor(() => {
                expect(screen.getByText('请求失败')).toBeInTheDocument()
            })
        })
    })

    describe('disabled 属性', () => {
        it('disabled 时选项按钮不可点击', () => {
            const tool = makeTool([{
                question: 'Q?',
                header: 'H',
                options: [{ label: 'OptA' }],
                multiSelect: false,
            }])

            renderFooter(tool, true)
            expect(findOptionBtn('OptA')).toHaveAttribute('aria-disabled', 'true')
        })
    })

    describe('非 pending 状态', () => {
        it('permission 非 pending 时返回 null', () => {
            const tool: ToolInfo = {
                name: 'AskUserQuestion',
                input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] },
                result: undefined,
                state: 'running',
                description: null,
                startedAt: null,
                createdAt: Date.now(),
                permission: {
                    id: 'perm-1',
                    status: 'approved',
                    createdAt: Date.now(),
                },
            }
            const { container } = render(
                <AskUserQuestionFooter
                    api={mockApi}
                    sessionId="session-1"
                    tool={tool}
                    disabled={false}
                    onDone={vi.fn()}
                />,
                { wrapper }
            )
            expect(container.innerHTML).toBe('')
        })
    })

    describe('非 AskUserQuestion 工具', () => {
        it('非 AUQ 工具名时返回 null', () => {
            const tool = makeTool([{
                question: 'Q?',
                options: [{ label: 'A' }],
            }], 'Bash')
            const { container } = render(
                <AskUserQuestionFooter
                    api={mockApi}
                    sessionId="session-1"
                    tool={tool}
                    disabled={false}
                    onDone={vi.fn()}
                />,
                { wrapper }
            )
            expect(container.innerHTML).toBe('')
        })
    })

    describe('共享 OptionRow', () => {
        it('选中项带 data-selected=true 与 antd Checkbox 选中态', () => {
            const tool = makeTool([{
                question: 'Q', multiSelect: true,
                options: [{ label: 'A', description: null, preview: null }],
            }])
            renderFooter(tool)
            const a = findOptionBtn('A')
            fireEvent.click(a)
            expect(a.getAttribute('data-selected')).toBe('true')
            // 不再有左侧色带（四重堆叠已收敛），选中态由 antd Checkbox 实心方块承载
            expect(a.querySelector('[data-slot="bar"]')).toBeNull()
            expect(a.querySelector('input[type="checkbox"]')).not.toBeNull()
        })
    })

    describe('回归：code-review 修复', () => {
        it('点击「其他」后 TextArea 可聚焦输入，不因冒泡消失', () => {
            const tool = makeTool([{
                question: 'Q', multiSelect: false,
                options: [{ label: 'A', description: null, preview: null }],
            }])
            renderFooter(tool)
            fireEvent.click(findOptionBtn('其他'))
            const ta = document.querySelector('textarea') as HTMLElement
            expect(ta).toBeInTheDocument()
            // 模拟用户点击 textarea 聚焦 —— 不应触发 toggle 把它收起
            fireEvent.click(ta)
            expect(document.querySelector('textarea')).not.toBeNull()
        })
    })

    describe('聊一聊按钮', () => {
        it('点击聊一聊 → 调 permissions.deny 带 seed reason（含问题与已选答案）', async () => {
            mockDeny.mockResolvedValue(undefined)
            const tool = makeTool([{
                question: 'Which lib?',
                header: 'Lib',
                options: [
                    { label: 'JWT', description: null, preview: null },
                    { label: 'OAuth', description: null, preview: null },
                ],
                multiSelect: false,
            }])
            renderFooter(tool)
            fireEvent.click(findOptionBtn('JWT'))
            fireEvent.click(screen.getByText('聊一聊'))

            await waitFor(() => {
                expect(mockDeny).toHaveBeenCalledTimes(1)
            })
            const args = mockDeny.mock.calls[0]
            const body = args[args.length - 1] // body 可能是第 2 或第 3 参数，取最后一个
            expect(body).toHaveProperty('reason')
            const reason: string = (body as { reason: string }).reason
            expect(reason).toContain('The user wants to clarify these questions.')
            expect(reason).toContain('- "Which lib?"')
            expect(reason).toContain('Answer: JWT')
            expect(mockApprove).not.toHaveBeenCalled()
        })
    })
})
