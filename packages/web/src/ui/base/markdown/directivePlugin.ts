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
 *
 * quote 协议统一（spec .scratch/quote-protocol-unification）后新增
 * {@link quoteXmlExtension}：出向新 XML 形态 `<quote index="N"/>`（含完整回显形态，
 * 只取 index）同样渲染为 `<mobi-directive>` 走统一路由，语法单源 shared
 * quoteProtocol（QUOTE_XML_SHAPE），扫描与 tokenizer 判定不漂移。
 */

import type { Tokens, TokenizerAndRendererExtension } from 'marked'
import { QUOTE_XML_OPEN, QUOTE_XML_SHAPE } from '@mobi/shared'
import { DIRECTIVE_SHAPE, findDirectiveStart } from '@/domain/chat/directives'

/** directive 完整形态（派生自 domain 单源，锚定串首供 tokenizer 逐段匹配） */
const DIRECTIVE_TOKEN_RE = new RegExp(`^${DIRECTIVE_SHAPE}`)

/** quote XML 完整形态（派生自 shared 单源，锚定串首供 tokenizer 逐段匹配） */
const QUOTE_XML_TOKEN_RE = new RegExp(`^${QUOTE_XML_SHAPE}`)

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

/** quote XML 形态的下一个起点；无命中返回 -1（marked start 约定）。前缀常量
 *  单源 shared QUOTE_XML_OPEN，indexOf 未命中本身即 -1，无需前置 includes 守卫
 *  （两个分支都是子串扫描，守卫只会白多扫一遍） */
export function findQuoteXmlStart(src: string): number {
    return src.indexOf(QUOTE_XML_OPEN)
}

export function quoteXmlExtension(): TokenizerAndRendererExtension {
    return {
        name: 'mobiQuoteXml',
        level: 'inline',
        start(src: string) {
            return findQuoteXmlStart(src)
        },
        tokenizer(src: string) {
            // 只认正形（自闭合 / 完整回显收口）：流式半截由 Markdown 的截断扣住
            const match = src.match(QUOTE_XML_TOKEN_RE)
            if (!match) return undefined

            return {
                type: 'mobiQuoteXml',
                raw: match[0],
                renderType: 'component' as const,
            }
        },
        renderer(token: Tokens.Generic) {
            const raw = typeof token.raw === 'string' ? token.raw : ''
            // 与 directive 同一自定义标签走统一路由（MobiDirective 按 shared 解析分发）
            return `<mobi-directive data-raw="${encodeURIComponent(raw)}"></mobi-directive>`
        },
    }
}
