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
 * 流式 directive 原子揭示（2026-09-28 真机：流式期间指令裸文本、刷新后成钮）。
 * 根因：drip 逐字揭示让 `:mobi-*{...}` 以半截进入 x-markdown，其流式 recognizer
 * 不覆盖自定义扩展，半截 Text commit 后闭合不重识别。修复 = drip 路径扣住未闭合
 * 尾巴（truncateIncompleteDirectiveTail），闭合帧一次性完整进入 parse。
 * 成钮形态 = .quote-directive 上标（需 Provider 配对引用）；无数据降级 0.85em span。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TextBlock } from '@/components/chat/blocks/TextBlock'
import { QuoteAnnotationsProvider } from '@/components/ui/QuoteDirectiveComponents'

afterEach(cleanup)

const FULL = ':mobi-quote{index="1"}\n\n因为那一刻我没有回到代码。'
const HALF = ':mobi-quote{index="'
const QUOTES = [{
    type: 'quote', messageId: 'm0', role: 'agent' as const,
    excerpt: 'mobi 的位置：跟 ZCode 同构', startOffset: 1, endOffset: 2,
}]

function renderBlock(text: string, isStreaming?: boolean) {
    return render(
        <QuoteAnnotationsProvider quotes={QUOTES} onLocate={() => {}}>
            <TextBlock text={text} isStreaming={isStreaming} />
        </QuoteAnnotationsProvider>,
    )
}

describe('directive 原子揭示（drip 路径扣住半截尾巴）', () => {
    it('流式 + 半截 content：指令尾巴不进渲染（截断生效）', () => {
        const { container } = renderBlock(HALF, true)
        expect(container.innerHTML).not.toContain(':mobi-quote')
    })

    it('流式 + 完整 content：闭合帧成钮（一次性完整进入 parse）', () => {
        const { container } = renderBlock(FULL, true)
        expect(container.querySelector('.quote-directive')).toBeTruthy()
    })

    it('静态完整：成钮（回归基线）', () => {
        const { container } = renderBlock(FULL)
        expect(container.querySelector('.quote-directive')).toBeTruthy()
    })

    it('静态半截（模型真输出无闭合字面量）：诚实呈现原文不截断', () => {
        const { container } = renderBlock(HALF)
        expect(container.innerHTML).toContain(':mobi-quote')
    })
})
