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
 * marked 内联扩展：将模型输出的内联指令 `:mobi-<name>{...}` 统一渲染为自定义
 * `<mobi-directive>` 标签，由 XMarkdown 的 components 映射为 MobiDirective 路由
 * 组件（QuoteDirectiveComponents）。语法单源 domain/chat/directives。
 * 模式同 footnoteRefExtension。流式半截 directive 不命中 tokenizer——x-markdown
 * 的不完整语法占位负责过渡，闭合后自然成钮。
 */

import type { Tokens, TokenizerAndRendererExtension } from 'marked'
import { DIRECTIVE_PREFIX, DIRECTIVE_SHAPE } from '@/domain/chat/directives'

/** directive 完整形态（派生自 domain 单源，锚定串首供 tokenizer 逐段匹配） */
const DIRECTIVE_TOKEN_RE = new RegExp(`^${DIRECTIVE_SHAPE}`)

/** 指令原文 → HTML 安全文本（children 兜底展示用；data-raw 走 URI 编码无此需要） */
function escapeHtmlText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function directiveExtension(): TokenizerAndRendererExtension {
    return {
        name: 'mobiDirective',
        level: 'inline',
        start(src: string) {
            return src.indexOf(DIRECTIVE_PREFIX)
        },
        tokenizer(src: string) {
            const match = src.match(DIRECTIVE_TOKEN_RE)
            if (!match) return undefined

            return {
                type: 'mobiDirective',
                raw: match[0],
                renderType: 'component' as const,
            }
        },
        renderer(token: Tokens.Generic) {
            const raw = typeof token.raw === 'string' ? token.raw : ''
            // 原文双通道传递：data-raw（URI 编码，HTML 属性安全）是权威源；children 放
            // 转义原文兜底——组件路由缺失（未映射）时浏览器按原文呈现，不吞模型输出
            return `<mobi-directive data-raw="${encodeURIComponent(raw)}">${escapeHtmlText(raw)}</mobi-directive>`
        },
    }
}
