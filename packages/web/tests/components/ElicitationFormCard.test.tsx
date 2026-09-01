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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { ElicitationFormCard } from '@/components/chat/ElicitationFormCard'
import type { PermissionAnswers, SDKUIHints } from '@mobi/shared'

// mock i18next — 与 PermissionFooter.test.tsx 同样的模式
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                const map: Record<string, string> = {
                    'chat.elicitation.submit': '提交',
                    'chat.elicitation.decline': '拒绝',
                }
                return map[key] ?? key
            },
        }),
    }
})

// jsdom 没有 ResizeObserver（antd Select 需要）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const schema = {
    type: 'object',
    required: ['name'],
    properties: {
        name: { type: 'string', title: '名称' },
        count: { type: 'number', title: '数量' },
        flag: { type: 'boolean', title: '开关' },
        color: { type: 'string', enum: ['red', 'blue'], title: '颜色' },
    },
}

const mockSdkHints: SDKUIHints = { title: '测试表单', displayName: '测试服务器', description: '请如实填写' }

const onSubmit = vi.fn<(answers: PermissionAnswers) => void | Promise<void>>()
const onDecline = vi.fn<(reason?: string) => void | Promise<void>>()

function renderCard(overrides: Partial<Parameters<typeof ElicitationFormCard>[0]> = {}) {
    return render(
        <ElicitationFormCard
            requestId="req-1"
            serverName="tester"
            message="请填写信息"
            requestedSchema={schema}
            sdkHints={mockSdkHints}
            onSubmit={onSubmit}
            onDecline={onDecline}
            {...overrides}
        />,
        { wrapper: ({ children }) => <ConfigProvider>{children}</ConfigProvider> },
    )
}

describe('ElicitationFormCard（批次 C，spec D4）', () => {
    beforeEach(() => {
        onSubmit.mockClear()
        onDecline.mockClear()
    })

    afterEach(() => {
        cleanup()
    })

    it('按 schema 渲染四类控件（Input/InputNumber/Switch/Select）', () => {
        renderCard()

        // 头部：server 名 + message + sdkHints
        expect(screen.getByText('tester')).toBeInTheDocument()
        expect(screen.getByText('请填写信息')).toBeInTheDocument()
        expect(screen.getByText('请如实填写')).toBeInTheDocument()

        // string → Input
        expect(screen.getByRole('textbox')).toBeInTheDocument()
        // number → InputNumber
        expect(screen.getByRole('spinbutton')).toBeInTheDocument()
        // boolean → Switch
        expect(screen.getByRole('switch')).toBeInTheDocument()
        // enum → Select
        expect(screen.getByRole('combobox')).toBeInTheDocument()

        // 字段标签来自 title
        expect(screen.getByText('名称')).toBeInTheDocument()
        expect(screen.getByText('数量')).toBeInTheDocument()
        expect(screen.getByText('开关')).toBeInTheDocument()
        expect(screen.getByText('颜色')).toBeInTheDocument()

        // 底部动作
        expect(screen.getByRole('button', { name: /提\s*交/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /拒\s*绝/ })).toBeInTheDocument()
    })

    it('required 字段为空提交被校验拦截，onSubmit 未调用', async () => {
        renderCard()

        fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

        // 校验错误由 antd 渲染进 .ant-form-item-explain-error（默认文案随 locale 变化，不锁文案）
        await waitFor(() => {
            expect(document.querySelector('.ant-form-item-explain-error')).not.toBeNull()
        })
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('填写后提交，onSubmit 收到含 number/boolean 原生类型的 answers', async () => {
        renderCard()

        fireEvent.change(screen.getByRole('textbox'), { target: { value: '墨墨' } })
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
        fireEvent.click(screen.getByRole('switch'))

        fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1)
        })
        expect(onSubmit).toHaveBeenCalledWith({ name: '墨墨', count: 3, flag: true })
    })

    it('拒绝按钮触发 onDecline', async () => {
        renderCard()

        fireEvent.click(screen.getByRole('button', { name: /拒\s*绝/ }))

        await waitFor(() => {
            expect(onDecline).toHaveBeenCalledTimes(1)
        })
        expect(onSubmit).not.toHaveBeenCalled()
    })
})

// ─── code-review 修复：required boolean/number/integer + 不支持类型 ──────────

describe('ElicitationFormCard required 类型修正', () => {
    beforeEach(() => {
        onSubmit.mockClear()
        onDecline.mockClear()
    })
    afterEach(() => { cleanup() })

    it('required boolean：默认 Switch off（值 false）可直接提交 false', async () => {
        const requiredBoolSchema = {
            type: 'object',
            required: ['confirmed'],
            properties: { confirmed: { type: 'boolean', title: '确认' } },
        }
        renderCard({ requestedSchema: requiredBoolSchema })

        // 不触碰 Switch，直接提交
        fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1)
        })
        expect(onSubmit).toHaveBeenCalledWith({ confirmed: false })
    })

    it('required number：填数字可直接提交（不被 async-validator type 错误拦截）', async () => {
        const requiredNumSchema = {
            type: 'object',
            required: ['count'],
            properties: { count: { type: 'number', title: '数量' } },
        }
        renderCard({ requestedSchema: requiredNumSchema })

        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
        fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1)
        })
        expect(onSubmit).toHaveBeenCalledWith({ count: 7 })
    })

    it('required integer：填整数可直接提交', async () => {
        const requiredIntSchema = {
            type: 'object',
            required: ['port'],
            properties: { port: { type: 'integer', title: '端口' } },
        }
        renderCard({ requestedSchema: requiredIntSchema })

        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8080' } })
        fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }))

        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1)
        })
        expect(onSubmit).toHaveBeenCalledWith({ port: 8080 })
    })

    it('不支持的字段类型（array）渲染禁用控件而非可输入输入框', () => {
        const arraySchema = {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' }, title: '标签' } },
        }
        renderCard({ requestedSchema: arraySchema })

        // array 字段渲染成禁用 input（标记不支持），不可填值（避免必败 decline）
        const textbox = screen.getByRole('textbox')
        expect(textbox).toBeDisabled()
        expect(screen.getByText('标签')).toBeInTheDocument()
    })
})
