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

import type { HLJSApi } from 'highlight.js'

/** highlight.js common 子集懒加载（包含约 38 种最常用语言） */
let hljsPromise: Promise<HLJSApi> | null = null
function getHljs(): Promise<HLJSApi> {
    if (!hljsPromise) {
        hljsPromise = import('highlight.js/lib/common').then(m => m.default as HLJSApi)
    }
    return hljsPromise
}

/**
 * 检测结果缓存（按代码内容分），LRU 形式。
 * 流式渲染时每次代码增量都会形成新键，需要上限避免长会话内存膨胀。
 */
const detectCache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 256

function cacheGet(key: string): string | undefined {
    const value = detectCache.get(key)
    if (value === undefined) return undefined
    // LRU touch：移到末尾
    detectCache.delete(key)
    detectCache.set(key, value)
    return value
}

function cacheSet(key: string, value: string): void {
    if (!detectCache.delete(key) && detectCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = detectCache.keys().next().value
        if (oldest !== undefined) detectCache.delete(oldest)
    }
    detectCache.set(key, value)
}

/** 单次检测的最大字符数，超长代码会截断以保证性能 */
const MAX_DETECT_CHARS = 4096

/**
 * 检测兜底语言：prism 的 C-family 元语言，覆盖关键字 / 字符串 / 注释 / 数字 / 操作符，
 * 对绝大多数代码都能给出可读的高亮，对非代码也几乎无副作用。
 */
export const FALLBACK_LANGUAGE = 'clike'

/**
 * highlight.js 候选语言子集 —— 避开 scss/css/coffeescript 等短样本上 false-positive 严重的语言。
 * 仅包含主流编程 + 数据/配置语言，覆盖绝大多数代码块场景。
 */
const HLJS_CANDIDATE_LANGUAGES = [
    'javascript', 'typescript',
    'python', 'java', 'go', 'rust', 'kotlin', 'swift', 'scala',
    'c', 'cpp', 'csharp', 'objectivec',
    'php', 'ruby', 'perl', 'lua',
    'bash', 'shell', 'powershell',
    'sql', 'json', 'yaml', 'xml', 'markdown', 'dockerfile', 'makefile', 'ini',
] as const

/**
 * highlight.js 语言名 → react-syntax-highlighter (prismjs) 语言名映射。
 * 仅列出名称不一致的，其余直接透传。
 */
const HLJS_TO_PRISM: Record<string, string> = {
    xml: 'markup',
    html: 'markup',
    shell: 'bash',
    dockerfile: 'docker',
}

/** 同步获取已缓存的检测结果（未命中返回 undefined） */
export function getCachedDetectedLanguage(code: string): string | undefined {
    return cacheGet(code)
}

/** 异步检测代码语言，返回 prism 可用的语言名；检测失败 / 无结果时返回兜底通用语言。结果带缓存 */
export async function detectLanguage(code: string): Promise<string> {
    const cached = cacheGet(code)
    if (cached !== undefined) return cached

    try {
        const hljs = await getHljs()
        const sample = code.length > MAX_DETECT_CHARS ? code.slice(0, MAX_DETECT_CHARS) : code
        const result = hljs.highlightAuto(sample, [...HLJS_CANDIDATE_LANGUAGES])
        const detected = result.language
            ? (HLJS_TO_PRISM[result.language] ?? result.language)
            : FALLBACK_LANGUAGE
        cacheSet(code, detected)
        return detected
    } catch {
        cacheSet(code, FALLBACK_LANGUAGE)
        return FALLBACK_LANGUAGE
    }
}
