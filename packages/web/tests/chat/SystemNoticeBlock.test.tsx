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
 * SystemNoticeBlock 渲染测试（spec .scratch/system-informational-banner）：
 * content 原样显示不翻译、warning 级使用主题 warning 色 token（与非 warning 中性配色可区分）、
 * preventContinuation 附「已停止执行」标记（i18n key 断言）。
 * 主题 token 值经探针组件取 antd useToken 真实值比对（jsdom 下为 antd 默认算法），
 * 不硬编码色值——换主题算法测试仍应成立。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { theme as antTheme } from 'antd'
import { SystemNoticeBlock } from '@/components/chat/blocks/SystemNoticeBlock'
import type { SystemNoticeBlock as SystemNoticeBlockType, SystemNoticeLevel } from '@/domain/chat/types'

// react-i18next 走 key 直通（断言 key 而非语言文案，翻译内容由真实资源文件承载）
vi.mock('react-i18next', async (orig) => {
    const actual = await orig<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

// useToken 探针：取当前主题 token 真实值供断言比对
let tokenProbe: ReturnType<typeof antTheme.useToken>['token']
function TokenProbe() {
    tokenProbe = antTheme.useToken().token
    return null
}

afterEach(cleanup)

function makeBlock(overrides: Partial<SystemNoticeBlockType> = {}): SystemNoticeBlockType {
    return {
        kind: 'system-notice',
        id: 'notice-1',
        createdAt: 1000,
        content: 'Model fallback engaged: quota exceeded',
        level: 'warning',
        ...overrides,
    }
}

function renderBlock(block: SystemNoticeBlockType): ReturnType<typeof render> {
    return render(
        <>
            <TokenProbe />
            <SystemNoticeBlock block={block} />
        </>,
    )
}

// jsdom 会把内联样式里的 hex 色值规范化为 rgb() 形式——经探针元素走同一规范化路径再比对
function normalizeColor(cssProp: string, value: string): string {
    const el = document.createElement('div')
    el.style.setProperty(cssProp, value)
    return el.style.getPropertyValue(cssProp)
}

describe('SystemNoticeBlock', () => {
    it('content 原样显示（英文原文不翻译）', () => {
        renderBlock(makeBlock())
        expect(screen.getByText('Model fallback engaged: quota exceeded')).toBeTruthy()
    })

    it('warning 级使用主题 warning 色 token（左边条 accent / 浅底，token 实值比对）', () => {
        const { container } = renderBlock(makeBlock({ level: 'warning' }))
        const banner = container.querySelector('[data-notice-level="warning"]') as HTMLElement
        expect(banner).toBeTruthy()
        expect(banner.style.borderLeftColor).toBe(normalizeColor('border-left-color', tokenProbe.colorWarning))
        expect(banner.style.background).toBe(normalizeColor('background', tokenProbe.colorWarningBg))
    })

    it('非 warning 级走中性配色，与 warning 档视觉可区分（双档约束）', () => {
        const { container } = renderBlock(makeBlock({ level: 'notice', preventContinuation: true }))
        const banner = container.querySelector('[data-notice-level="notice"]') as HTMLElement
        expect(banner).toBeTruthy()
        // 中性档不使用 warning 色 token
        expect(banner.style.borderLeftColor).not.toBe(tokenProbe.colorWarning)
        expect(banner.style.background).not.toBe(tokenProbe.colorWarningBg)
    })

    it('preventContinuation=true 渲染「已停止执行」标记（i18n key）', () => {
        renderBlock(makeBlock({ preventContinuation: true }))
        expect(screen.getByText('chat.systemNotice.executionStopped')).toBeTruthy()
    })

    it('preventContinuation 缺省不渲染标记', () => {
        const { container } = renderBlock(makeBlock({ level: 'notice' as SystemNoticeLevel }))
        expect(screen.queryByText('chat.systemNotice.executionStopped')).toBeNull()
        expect(container.querySelector('[data-notice-level="notice"]')).toBeTruthy()
    })
})
