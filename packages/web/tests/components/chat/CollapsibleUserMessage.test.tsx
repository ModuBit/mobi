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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
    CollapsibleUserMessage,
    USER_MESSAGE_COLLAPSE_THRESHOLD,
    estimateUserMessageOverflow,
} from '@/components/chat/CollapsibleUserMessage'

// mock i18next
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

/** 覆盖 HTMLElement.scrollHeight，模拟布局测量（jsdom 无真实布局） */
function mockScrollHeight(height: number) {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () => height,
    })
}

/** 恢复 scrollHeight 默认值（0） */
function restoreScrollHeight() {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () => 0,
    })
}

/** 读取 content 容器（折叠 class 的载体） */
function getContent(container: HTMLElement): HTMLElement {
    return container.querySelector('.collapsible-user-msg__content') as HTMLElement
}

/** 一段足以触发预估为「长」的文本（字符数 > ESTIMATE_CHAR_LIMIT） */
const LONG_TEXT = 'x'.repeat(400)

describe('estimateUserMessageOverflow', () => {
    it('空文本不预估为长', () => {
        expect(estimateUserMessageOverflow('')).toBe(false)
    })

    it('短文本不预估为长', () => {
        expect(estimateUserMessageOverflow('一行短消息')).toBe(false)
    })

    it('行数超过阈值预估为长', () => {
        const text = Array(10).fill('行').join('\n')
        expect(estimateUserMessageOverflow(text)).toBe(true)
    })

    it('字符数超过阈值预估为长（单行长文本兜底）', () => {
        expect(estimateUserMessageOverflow('x'.repeat(400))).toBe(true)
    })
})

describe('CollapsibleUserMessage', () => {
    beforeEach(() => {
        // ResizeObserver stub：observe 时触发 callback，模拟真实 RO 的首次异步回调
        // （组件 useEffect 靠 RO 首次回调测量 scrollHeight → setClippable）
        vi.stubGlobal('ResizeObserver', class {
            constructor(private cb: () => void) {}
            observe() { this.cb() }
            unobserve() { /* noop */ }
            disconnect() { /* noop */ }
        })
    })

    afterEach(() => {
        cleanup()
        restoreScrollHeight()
        vi.unstubAllGlobals()
    })

    it('未超阈值时不显示按钮，也不折叠', () => {
        mockScrollHeight(USER_MESSAGE_COLLAPSE_THRESHOLD)
        const { container } = render(
            <CollapsibleUserMessage>
                <p>短消息</p>
            </CollapsibleUserMessage>,
        )

        expect(screen.queryByRole('button')).toBeNull()
        expect(getContent(container).className).not.toContain('collapsible-user-msg__content--collapsed')
    })

    it('测量超阈值时折叠并显示按钮（双向测量）', () => {
        mockScrollHeight(USER_MESSAGE_COLLAPSE_THRESHOLD + 100)
        const { container } = render(
            <CollapsibleUserMessage>
                <p>长消息</p>
            </CollapsibleUserMessage>,
        )

        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(getContent(container).className).toContain('collapsible-user-msg__content--collapsed')
    })

    it('预估为长但实测不超阈值时，双向修正为不折叠（不永久错误折叠）', () => {
        // 文本 400 字符 → 预估为长（首帧折叠）；但实测 scrollHeight 未超阈值 → 应修正回无按钮
        mockScrollHeight(USER_MESSAGE_COLLAPSE_THRESHOLD - 50)
        const { container } = render(
            <CollapsibleUserMessage text={LONG_TEXT}>
                <p>{LONG_TEXT}</p>
            </CollapsibleUserMessage>,
        )

        expect(screen.queryByRole('button')).toBeNull()
        expect(getContent(container).className).not.toContain('collapsible-user-msg__content--collapsed')
    })

    it('点击展开后切换为展开态，再次点击收起', () => {
        mockScrollHeight(USER_MESSAGE_COLLAPSE_THRESHOLD + 100)
        const { container } = render(
            <CollapsibleUserMessage text={LONG_TEXT}>
                <p>很长的消息</p>
            </CollapsibleUserMessage>,
        )

        const toggle = screen.getByRole('button')
        const content = getContent(container)

        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(toggle.getAttribute('data-expanded')).toBe('true')
        expect(content.className).not.toContain('collapsible-user-msg__content--collapsed')

        fireEvent.click(toggle)
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
        expect(content.className).toContain('collapsible-user-msg__content--collapsed')
    })

    it('支持自定义 threshold（通过 CSS 变量注入）', () => {
        mockScrollHeight(60)
        const { container } = render(
            <CollapsibleUserMessage threshold={50} text={LONG_TEXT}>
                <p>中等长度消息</p>
            </CollapsibleUserMessage>,
        )

        // 60 > 50 → 应折叠
        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(getContent(container).style.getPropertyValue('--collapsible-threshold')).toBe('50px')
    })

    it('text 不变时 rerender 跳过重渲（memo 自定义比较忽略 children 引用）', () => {
        // user-text 的 children 由 text 唯一决定，text 相同即视为相等，跳过 reconcile。
        // 这让流式期间未变化的用户消息气泡不被重渲。
        mockScrollHeight(USER_MESSAGE_COLLAPSE_THRESHOLD)
        const { container, rerender } = render(
            <CollapsibleUserMessage text="same"><p data-testid="c">A</p></CollapsibleUserMessage>,
        )
        expect(container.querySelector('[data-testid=c]')?.textContent).toBe('A')

        // rerender：text 相同，children 换成新元素（模拟 renderChatBlock 每次新建 JSX）
        rerender(
            <CollapsibleUserMessage text="same"><p data-testid="c">B</p></CollapsibleUserMessage>,
        )
        // memo 生效 → 跳过重渲 → DOM 仍是 A（children 未被替换）
        expect(container.querySelector('[data-testid=c]')?.textContent).toBe('A')

        // text 变了 → 重渲 → 新 children 生效
        rerender(
            <CollapsibleUserMessage text="changed"><p data-testid="c">C</p></CollapsibleUserMessage>,
        )
        expect(container.querySelector('[data-testid=c]')?.textContent).toBe('C')
    })
})
