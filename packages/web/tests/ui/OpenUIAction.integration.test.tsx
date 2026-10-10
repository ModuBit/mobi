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

/**
 * 回路② send-message 回灌规格（generative-ui 票 03）：
 * - Button 点击（用户显式手势）→ 经 UiSendProvider 注入的 sendMessage 发出，
 *   文本含 label 与当前表单值；
 * - 无 provider（会话页外渲染）→ 点击不抛错、不发送；
 * - 无任何自动发送路径：挂载/流式期间即使点击也不发送（验收④的测试面——
 *   onAction 只在交互回调里被 react-lang 调起，代码侧见 renderer.tsx handleAction）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { streamingDisplayState } from '../helpers/streamingContentMock'
vi.mock('@/components/ui/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const { Markdown } = await import('@/components/ui/Markdown')
const { UiSendProvider } = await import('@/components/ui/openui/actionContext')
// 懒 chunk 直连：流式守卫 seam 在 renderer 的 streaming prop（经 Markdown 时由块级
// 揭示状态派生——mock 下即时全显恒 done，测不到 loading 态，故绕过直接渲染）
const OpenUIRenderer = (await import('@/components/ui/openui/renderer')).default

// 官方 prompt 示例的 contact form（Form(name, buttons, fields) 教学形态）
const FORM_SAMPLE = `root = Stack([title, form])
title = TextContent("Contact Us", "large-heavy")
form = Form("contact", btns, [nameField, msgField])
nameField = FormControl("Name", Input("name", "Your name", "text"))
msgField = FormControl("Message", TextArea("message", "Tell us more...", 4))
btns = Buttons([Button("Submit", Action([@ToAssistant("Submit")]), "primary")])`

const fenced = (body: string) => '```openui\n' + body + '\n```'

/** 渲染带 provider 的 fenced 表单，返回 sendMessage spy */
function renderWithProvider(streaming = false) {
    const sendMessage = vi.fn()
    streamingDisplayState.current = fenced(FORM_SAMPLE)
    render(
        <UiSendProvider sendMessage={sendMessage}>
            <Markdown content={fenced(FORM_SAMPLE)} streaming={streaming} />
        </UiSendProvider>,
    )
    return sendMessage
}

async function ready() {
    await screen.findByText('Contact Us')
    await screen.findByText('Submit')
}

describe('回路②：openui Button → send-message 回灌', () => {
    afterEach(() => cleanup())

    it('点击 Button → sendMessage 收到 label + 当前表单值', async () => {
        const sendMessage = renderWithProvider()
        await ready()

        // 填入表单值（点击时刻的 formState 应携带）
        const input = screen.getByPlaceholderText('Your name')
        fireEvent.change(input, { target: { value: '林墨墨' } })

        fireEvent.click(screen.getByText('Submit'))

        expect(sendMessage).toHaveBeenCalledTimes(1)
        const text = sendMessage.mock.calls[0][0] as string
        expect(text).toContain('Submit')
        expect(text).toContain('表单「contact」当前值：')
        expect(text).toContain('林墨墨')
    })

    it('流式期间点击 → 不发送（块自身未封口）', async () => {
        const sendMessage = vi.fn()
        render(
            <UiSendProvider sendMessage={sendMessage}>
                <OpenUIRenderer code={FORM_SAMPLE} streaming />
            </UiSendProvider>,
        )
        await screen.findByText('Contact Us')
        await screen.findByText('Submit')

        fireEvent.click(screen.getByText('Submit'))

        expect(sendMessage).not.toHaveBeenCalled()
    })

    it('无 provider（会话页外渲染）→ 点击不抛错、不发送', async () => {
        streamingDisplayState.current = fenced(FORM_SAMPLE)
        render(<Markdown content={fenced(FORM_SAMPLE)} />)
        await ready()

        expect(() => fireEvent.click(screen.getByText('Submit'))).not.toThrow()
    })

    it('挂载不触发发送（无自动路径）', async () => {
        const sendMessage = renderWithProvider()
        await ready()

        expect(sendMessage).not.toHaveBeenCalled()
    })
})
