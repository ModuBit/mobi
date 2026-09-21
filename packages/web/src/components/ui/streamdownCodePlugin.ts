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
 * Streamdown 代码高亮插件适配器（ticket 07）
 *
 * @streamdown/code 提供 shiki 运行时高亮，但内置无语言检测（无 lang 围栏一律按
 * text 纯文本渲染）。本适配器包装官方插件，把 mobi 的 detectLanguage 自动检测
 * （含缓存与兜底）接进 highlight 调用，语义与旧栈 AutoDetectCodeBlock 一致：
 * - 显式 lang 优先，仅做语言名归一（prism/hljs 名 → shiki 名）
 * - 无 lang：缓存命中直接用检测结果；未命中先以兜底语言同步着色（不白屏），
 *   异步检测完成后回调刷新为检测语言
 * - 双主题由 Streamdown 的 shikiTheme prop 注入（highlight options.themes），
 *   深浅切换走 CSS dark: 变体（index.css @custom-variant），无需重建插件
 */

import { createCodePlugin, type CodeHighlighterPlugin } from '@streamdown/code'
import { detectLanguage, getCachedDetectedLanguage, FALLBACK_LANGUAGE } from '@/core/utils/codeLanguageDetect'

/**
 * detectLanguage 返回 prism/highlight.js 语言名，shiki 仅部分同名。
 * 只列名称不一致的映射，其余透传；归一后仍不支持的由官方插件内部兜底 text。
 */
const PRISM_TO_SHIKI: Record<string, string> = {
    clike: 'cpp', // 旧栈 prism 的 C-family 元语言兜底，shiki 无此语言，映射到 cpp
    markup: 'xml',
    html: 'xml',
    docker: 'dockerfile',
    objectivec: 'objective-c',
}

/** 语言名归一：prism/hljs 名 → shiki 语言名（HighlightOptions.language 运行时接受任意串，官方插件内部兜底） */
function toShikiLanguage(language: string): string {
    return PRISM_TO_SHIKI[language] ?? language
}

/** 带语言检测的 Streamdown 代码高亮插件（返回类型驱动方法参数的上下文类型） */
export function createMobiCodePlugin(): CodeHighlighterPlugin {
    const inner = createCodePlugin()
    // 官方 highlight 的缓存以「代码内容 + 语言 + 主题」为键、回调按键去重——
    // 先以兜底语言着色、再以检测语言二次调用是官方机制内的正常用法
    return {
        ...inner,
        name: 'shiki',
        type: 'code-highlighter',
        supportsLanguage(language) {
            return inner.supportsLanguage(toShikiLanguage(language) as never)
        },
        highlight(options, callback) {
            const explicit = (options.language ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
            // 显式 lang：名称归一后直接交给 shiki
            if (explicit) {
                return inner.highlight({ ...options, language: toShikiLanguage(explicit) } as typeof options, callback)
            }
            // 无 lang：缓存命中直接用检测结果
            const cached = getCachedDetectedLanguage(options.code)
            if (cached) {
                return inner.highlight({ ...options, language: toShikiLanguage(cached) } as typeof options, callback)
            }
            // 未命中：先以兜底语言同步着色（clike→cpp，与旧栈兜底语义一致），检测完成后回调刷新
            void detectLanguage(options.code).then((detected) => {
                inner.highlight({ ...options, language: toShikiLanguage(detected) } as typeof options, callback)
            })
            return inner.highlight({ ...options, language: toShikiLanguage(FALLBACK_LANGUAGE) } as typeof options, callback)
        },
    }
}
