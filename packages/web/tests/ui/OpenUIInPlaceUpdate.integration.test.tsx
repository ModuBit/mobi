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
vi.mock('@/ui/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const { Markdown } = await import('@/ui/Markdown')
const { UiSendProvider, OpenUIAnchorProvider } = await import('@/ui/openui/actionContext')
const { useOpenUIActionStore } = await import('@/ui/openui/actionStore')

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
        // formState 恒传出（票 02）：原始快照含 $ 机制键，daemon 落库端负责资格与限长；
        // stateVar = 绑定表唯一状态变量（per-action 票 02：单操作块恒定身份，两键一致去重才成立）
        expect(sendMessage.mock.calls[0][1]).toEqual({ origin: 'openui', anchor: ANCHOR, formState: { $actionState: 'idle' }, stateVar: '$actionState' })
        // markdown content 恒定（原地更新不动消息文本）
        expect(streamingDisplayState.current).toBe(fenced(ACTION_BLOCK))
        expect(await screen.findByText('执行中…')).toBeInTheDocument()
        expect(useOpenUIActionStore.getState().phases.get(`${ANCHOR}#$actionState`)).toBe('running')
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

        act(() => useOpenUIActionStore.getState().setPhase(`${ANCHOR}#$actionState`, 'done'))
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
        // 无锚点：origin 仍显式（openui 档），只是不带 anchor（档②退化）；stateVar 同样恒定
        expect(sendMessage.mock.calls[0][1]).toEqual({ origin: 'openui', formState: { $actionState: 'idle' }, stateVar: '$actionState' })
        // 无锚点不注入 initialState——label 恒 idle 文案
        expect(screen.getByText('预订')).toBeInTheDocument()
        expect(useOpenUIActionStore.getState().phases.size).toBe(0)
    })

    it('Set 教学句式：置位值入事件载荷 → stateVar 透传 + 复合键翻转（per-action 票 02）', async () => {
        // 教学句式形态：Set 先于 ToAssistant（运行时实证：置位值进入事件 formState）
        const setBlock = [
            'root = Stack([btn])',
            '$actionState = "idle"',
            'btn = Button(btnLabel, Action([Set($actionState, "running"), @ToAssistant("预订")]), "primary")',
            'btnLabel = $actionState == "done" ? "已完成 ✓" : ($actionState == "running" ? "执行中…" : "预订")',
        ].join('\n')
        const sendMessage = vi.fn()
        streamingDisplayState.current = fenced(setBlock)
        render(
            <UiSendProvider sendMessage={sendMessage}>
                <OpenUIAnchorProvider anchor={ANCHOR}>
                    <Markdown content={fenced(setBlock)} />
                </OpenUIAnchorProvider>
            </UiSendProvider>,
        )
        await screen.findByText('预订')

        fireEvent.click(screen.getByText('预订'))

        // 事件里的 running 置位值（Set 目标）= 身份自证，stateVar 走 Set 目标通道
        expect(sendMessage.mock.calls[0][1]).toMatchObject({ stateVar: '$actionState', anchor: ANCHOR })
        expect(useOpenUIActionStore.getState().phases.get(`${ANCHOR}#$actionState`)).toBe('running')
        expect(await screen.findByText('执行中…')).toBeInTheDocument()
    })

    it('双操作各自独立：点 A 只有 A 翻转，B 保持 idle 可点（per-action 票 02）', async () => {
        // 复刻 E2E 实锤串状态现场（11:44 双卡）的最小形态：单 fence 两按钮两变量
        const dualBlock = [
            'root = Stack([mdBtn, jsonBtn])',
            '$mdState = "idle"',
            '$jsonState = "idle"',
            'mdBtn = Button(mdLabel, Action([Set($mdState, "running"), @ToAssistant("数 md")]), "primary")',
            'mdLabel = $mdState == "done" ? "已完成 ✓" : ($mdState == "running" ? "执行中…" : "数 md")',
            'jsonBtn = Button(jsonLabel, Action([Set($jsonState, "running"), @ToAssistant("数 json")]), "primary")',
            'jsonLabel = $jsonState == "done" ? "已完成 ✓" : ($jsonState == "running" ? "执行中…" : "数 json")',
        ].join('\n')
        const sendMessage = vi.fn()
        streamingDisplayState.current = fenced(dualBlock)
        render(
            <UiSendProvider sendMessage={sendMessage}>
                <OpenUIAnchorProvider anchor={ANCHOR}>
                    <Markdown content={fenced(dualBlock)} />
                </OpenUIAnchorProvider>
            </UiSendProvider>,
        )
        await screen.findByText('数 md')
        await screen.findByText('数 json')

        fireEvent.click(screen.getByText('数 md'))
        await screen.findByText('执行中…')

        // 只发一条且带 A 的身份变量
        expect(sendMessage).toHaveBeenCalledTimes(1)
        expect(sendMessage.mock.calls[0][1]).toMatchObject({ stateVar: '$mdState' })
        // A 复合键翻转，B 保持 idle
        expect(useOpenUIActionStore.getState().phases.get(`${ANCHOR}#$mdState`)).toBe('running')
        expect(useOpenUIActionStore.getState().phases.has(`${ANCHOR}#$jsonState`)).toBe(false)
        // B 文案未变、仍可点（第二击发送 B 自己的操作）
        expect(screen.getByText('数 json')).toBeInTheDocument()
        fireEvent.click(screen.getByText('数 json'))
        expect(sendMessage).toHaveBeenCalledTimes(2)
        expect(sendMessage.mock.calls[1][1]).toMatchObject({ stateVar: '$jsonState' })
    })
})
