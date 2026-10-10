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
 * 回路③原地更新规格（generative-ui 票 04）：
 * - 档③块（$actionState 声明 + 三元派生 label）初始渲染 idle 文案；
 * - 点击 → sendMessage 携 anchor（档③锚点）→ store 翻 running → 按钮文案
 *   原地翻「执行中…」（markdown content 不变——变更只发生在外部 store 注入的
 *   initialState reactive binding）；
 * - running 期间重复点击去重（不再发送）；
 * - store setPhase done → 文案翻「已完成 ✓」；
 * - 无锚点（档②块）不受 store 影响。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { streamingDisplayState } from '../helpers/streamingContentMock'
vi.mock('@/components/ui/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const { Markdown } = await import('@/components/ui/Markdown')
const { UiSendProvider, OpenUIAnchorProvider } = await import('@/components/ui/openui/actionContext')
const { useOpenUIActionStore } = await import('@/components/ui/openui/actionStore')

// 档③块（prompt additionalRules 教的 Action-state convention 形态）
const ACTION_BLOCK = `root = Stack([btn])
$actionState = "idle"
btn = Button(btnLabel, Action([@ToAssistant("预订")]), "primary")
btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")`

const fenced = (body: string) => '```openui\n' + body + '\n```'
const ANCHOR = 'agent-text-blk-1'

function renderActionBlock() {
    const sendMessage = vi.fn()
    streamingDisplayState.current = fenced(ACTION_BLOCK)
    render(
        <UiSendProvider sendMessage={sendMessage}>
            <OpenUIAnchorProvider anchor={ANCHOR}>
                <Markdown content={fenced(ACTION_BLOCK)} />
            </OpenUIAnchorProvider>
        </UiSendProvider>,
    )
    return sendMessage
}

describe('回路③：原地更新', () => {
    afterEach(() => {
        cleanup()
        act(() => useOpenUIActionStore.getState().clearAll())
    })

    it('初始渲染 idle 文案（预订）', async () => {
        renderActionBlock()
        expect(await screen.findByText('预订')).toBeInTheDocument()
    })

    it('点击 → 发送携 origin+anchor + 翻 running → 文案原地翻「执行中…」，content 不变', async () => {
        const sendMessage = renderActionBlock()
        await screen.findByText('预订')

        fireEvent.click(screen.getByText('预订'))

        expect(sendMessage).toHaveBeenCalledTimes(1)
        expect(sendMessage.mock.calls[0][1]).toEqual({ origin: 'openui', anchor: ANCHOR })
        // markdown content 恒定（原地更新不动消息文本）
        expect(streamingDisplayState.current).toBe(fenced(ACTION_BLOCK))
        expect(await screen.findByText('执行中…')).toBeInTheDocument()
        expect(useOpenUIActionStore.getState().phases.get(ANCHOR)).toBe('running')
    })

    it('running 期间重复点击去重（不再发送）', async () => {
        const sendMessage = renderActionBlock()
        await screen.findByText('预订')

        fireEvent.click(screen.getByText('预订'))
        await screen.findByText('执行中…')
        fireEvent.click(screen.getByText('执行中…'))

        expect(sendMessage).toHaveBeenCalledTimes(1)
    })

    it('setPhase done → 文案翻「已完成 ✓」', async () => {
        renderActionBlock()
        await screen.findByText('预订')

        fireEvent.click(screen.getByText('预订'))
        await screen.findByText('执行中…')

        act(() => useOpenUIActionStore.getState().setPhase(ANCHOR, 'done'))
        expect(await screen.findByText('已完成 ✓')).toBeInTheDocument()
    })

    it('无锚点（档②块）：点击照常发送但 store 不翻转、label 不变', async () => {
        const sendMessage = vi.fn()
        streamingDisplayState.current = fenced(ACTION_BLOCK)
        render(
            <UiSendProvider sendMessage={sendMessage}>
                <Markdown content={fenced(ACTION_BLOCK)} />
            </UiSendProvider>,
        )
        await screen.findByText('预订')

        fireEvent.click(screen.getByText('预订'))

        expect(sendMessage).toHaveBeenCalledTimes(1)
        // 无锚点：origin 仍显式（openui 档），只是不带 anchor（档②退化）
        expect(sendMessage.mock.calls[0][1]).toEqual({ origin: 'openui' })
        // 无锚点不注入 initialState——label 恒 idle 文案
        expect(screen.getByText('预订')).toBeInTheDocument()
        expect(useOpenUIActionStore.getState().phases.size).toBe(0)
    })
})
