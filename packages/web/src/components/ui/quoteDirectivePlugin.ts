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
 * marked 内联扩展：将回应批注 directive `:mobi-quote{index="N"}` 渲染为自定义
 * `<quote-directive>` 标签，由 XMarkdown 的 components 映射为 React 组件
 * （QuoteDirectiveMarker，注释按钮）。模式同 footnoteRefExtension。
 *
 * 字面量单源 shared QUOTE_DIRECTIVE（CLI 协议文案共用）。流式半截 directive
 * 不命中 tokenizer——x-markdown 的不完整语法占位负责过渡，闭合后自然成钮。
 */

import type { Tokens, TokenizerAndRendererExtension } from 'marked'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { QUOTE_DIRECTIVE_SHAPE } from '@/domain/chat/quoteDirectives'

/** directive 完整形态（派生自 domain 单源，锚定串首供 tokenizer 逐段匹配） */
const DIRECTIVE_TOKEN_RE = new RegExp(`^${QUOTE_DIRECTIVE_SHAPE}`)

export function quoteDirectiveExtension(): TokenizerAndRendererExtension {
    return {
        name: 'quoteDirective',
        level: 'inline',
        start(src: string) {
            return src.indexOf(QUOTE_DIRECTIVE)
        },
        tokenizer(src: string) {
            const match = src.match(DIRECTIVE_TOKEN_RE)
            if (!match) return undefined

            return {
                type: 'quoteDirective',
                raw: match[0],
                index: match[1],
                renderType: 'component' as const,
            }
        },
        renderer(token: Tokens.Generic) {
            const index = (token as unknown as { index: string }).index ?? '0'
            // children 放 directive 原文：无批注数据可解析时（伪造索引/越界/用户手打
            // 字面量）按原样呈现，诚实降级而非渲染一个点不动的按钮
            return `<quote-directive data-index="${index}">${QUOTE_DIRECTIVE}{index="${index}"}</quote-directive>`
        },
    }
}
