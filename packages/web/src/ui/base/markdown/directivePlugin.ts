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
 * marked 内联扩展 ×2，统一渲染为自定义 `<mobi-directive>` 标签，由 XMarkdown 的
 * components 映射为 MobiDirective 路由组件（QuoteDirectiveComponents）：
 *
 * 1. {@link directiveExtension}：旧 DSL 形态 `:mobi-<name>{...}`（读兼容，语法单源
 *    domain/chat/directives）。模式同 footnoteRefExtension。流式半截 directive 不
 *    命中 tokenizer——x-markdown 的不完整语法占位负责过渡，闭合后自然成钮。
 * 2. {@link mobiXmlExtension}：XML 指令族通用形态 `<mobi:name attrs/>`（spec
 *    .scratch/mobi-xml-namespace 票 02 收敛：quote / artifact 等族成员一个扩展管
 *    全部，正形与标签清单单源 domain XML_DIRECTIVE_*，按名字路由在 MobiDirective）。
 */

import type { Tokens, TokenizerAndRendererExtension } from 'marked'
import {
    DIRECTIVE_SHAPE,
    findDirectiveStart,
    XML_DIRECTIVE_OPENS,
    XML_DIRECTIVE_TOKEN_SHAPE,
} from '@/domain/chat/directives'

/** directive 完整形态（派生自 domain 单源，锚定串首供 tokenizer 逐段匹配） */
const DIRECTIVE_TOKEN_RE = new RegExp(`^${DIRECTIVE_SHAPE}`)

/** XML 指令族完整形态（派生自 domain 单源，锚定串首供 tokenizer 逐段匹配） */
const XML_TOKEN_RE = new RegExp(`^${XML_DIRECTIVE_TOKEN_SHAPE}`)

export function directiveExtension(): TokenizerAndRendererExtension {
    return {
        name: 'mobiDirective',
        level: 'inline',
        start(src: string) {
            // 同源放宽：变体前缀（::: / 全角冒号 / 带空格）也要能定位到指令起点
            return findDirectiveStart(src)
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
            // 原文经 URI 编码进 data-raw（HTML 属性安全），MobiDirective 解码后
            // 解析路由；未注册指令由其按原文诚实降级，不吞模型输出
            return `<mobi-directive data-raw="${encodeURIComponent(raw)}"></mobi-directive>`
        },
    }
}

/** XML 指令族标签的下一个起点；无命中返回 -1（marked start 约定）。全形态取最早
 *  出现位置；前缀清单单源 domain XML_DIRECTIVE_OPENS，indexOf 未命中本身即 -1 */
export function findMobiXmlStart(src: string): number {
    let start = -1
    for (const open of XML_DIRECTIVE_OPENS) {
        const i = src.indexOf(open)
        if (i !== -1 && (start === -1 || i < start)) start = i
    }
    return start
}

/** XML 指令族通用扩展：`<mobi:name attrs/>`（含 legacy `<quote/>` 与完整回显形态）
 *  一个扩展管全族，标签清单与正形单源 domain XML_DIRECTIVE_*（shared buildXmlTokenShape） */
export function mobiXmlExtension(): TokenizerAndRendererExtension {
    return {
        name: 'mobiXmlDirective',
        level: 'inline',
        start(src: string) {
            return findMobiXmlStart(src)
        },
        tokenizer(src: string) {
            // 只认正形（自闭合 / 完整回显收口）：流式半截由 Markdown 的截断扣住
            const match = src.match(XML_TOKEN_RE)
            if (!match) return undefined

            return {
                type: 'mobiXmlDirective',
                raw: match[0],
                renderType: 'component' as const,
            }
        },
        renderer(token: Tokens.Generic) {
            const raw = typeof token.raw === 'string' ? token.raw : ''
            // 与 directive 同一自定义标签走统一路由（MobiDirective 按标签名分发）
            return `<mobi-directive data-raw="${encodeURIComponent(raw)}"></mobi-directive>`
        },
    }
}
