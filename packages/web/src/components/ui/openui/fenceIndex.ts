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
 * openui fence 身份注解（generative-ui 状态持久化票 01）：档③锚点从 block 级
 * 下钻到 fence 级的身份段来源。
 *
 * x-markdown 的 code 组件映射（DefaultCode）不透传 mdast node，渲染层拿不到
 * fence 在源码中的位置；本模块在 content 进 XMarkdown 前做一次纯函数变换，
 * 给每个**完整** openui fence 的 info string 追加文档序 token（` mobi-fence-<n>`），
 * DefaultCode 从 lang（x-markdown 契约：完整 info string）反解序号。
 *
 * 稳定性由两个既有不变量保证（spec 裁决）：
 * - 消息 content 落库后不可变——同输入同输出，行号/序号跨刷新恒定；
 * - 流式 append-only——未闭合 fence 不编号（闭合即冻结，其后不可能有更早的
 *   fence 插入），已闭合 fence 的序号在后续 delta 中不漂移。
 *
 * anchor 只在用户点击时生成（renderer handleAction 流式 return），此后作为
 * 不透明字符串落库/配对，本模块不再参与。
 */

/** info string 里的身份 token 前缀（独立空格分隔 token，不污染语言识别首 token） */
export const FENCE_INDEX_TOKEN_PREFIX = 'mobi-fence-'

/** openui fence 开栏行：行首 ≥3 反引号 + openui / openui-lang（容忍既有与额外 info token） */
const OPENUI_FENCE_OPEN = /^(`{3,})[ \t]*(openui(?:-lang)?(?:[ \t]+[^\n]*?)?)[ \t]*$/
/** 任意反引号围栏开栏行（非 openui 的外层围栏——其内容不属于文档顶层 fence 序列） */
const FENCE_OPEN_ANY = /^(`{3,})/
/** GFM 闭栏行：行首反引号串、无 info string（长度须 ≥ 对应开栏，见 findFenceClose） */
const FENCE_CLOSE = /^(`{3,})\s*$/
/** 身份 token 匹配（模块级预编译——annotate/parse 在流式渲染热路径上逐次调用） */
const FENCE_TOKEN_RE = new RegExp(`${FENCE_INDEX_TOKEN_PREFIX}(\\d+)`)
const FENCE_TOKEN_BOUNDED_RE = new RegExp(`(?:^|\\s)${FENCE_INDEX_TOKEN_PREFIX}(\\d+)(?:$|\\s)`)

/** 从 from 起找围栏闭栏行：GFM 闭栏反引号数 ≥ 开栏——内容里更短的反引号行
 *  （嵌套代码示例等）不是闭栏；未闭合返回 -1 */
function findFenceClose(lines: readonly string[], from: number, openLen: number): number {
    for (let j = from; j < lines.length; j++) {
        const m = lines[j]!.match(FENCE_CLOSE)
        if (m && m[1]!.length >= openLen) return j
    }
    return -1
}

/**
 * 给 content 中每个完整 openui fence 的 info string 追加文档序身份 token。
 * 纯函数幂等：已带 token 的沿用原号（流式增长时新闭合 fence 从最大号+1 续编）；
 * 未闭合 fence 不编号（闭合前不渲染 OpenUIBlock，无消费方）。
 * 围栏上下文按 GFM 扫描：非 openui 外层围栏整体透传——其内部出现的 openui 样
 * 围栏行只是示例文本，不注解也不参与编号。
 */
export function annotateOpenuiFences(content: string): string {
    const lines = content.split('\n')
    const out: string[] = []
    let nextIndex = 0
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i]!.match(OPENUI_FENCE_OPEN)
        if (open) {
            const closeAt = findFenceClose(lines, i + 1, open[1]!.length)
            if (closeAt === -1) {
                out.push(...lines.slice(i))
                break
            }
            const info = open[2]!.trim()
            const existing = info.match(FENCE_TOKEN_RE)
            if (existing) {
                // 沿用原号（重扫已注解的 content），后续新 fence 从最大号+1 续编
                nextIndex = Math.max(nextIndex, Number.parseInt(existing[1]!, 10) + 1)
                out.push(lines[i]!)
            } else {
                out.push(`${open[1]}${info} ${FENCE_INDEX_TOKEN_PREFIX}${nextIndex}`)
                nextIndex++
            }
            out.push(...lines.slice(i + 1, closeAt + 1))
            i = closeAt
            continue
        }
        const anyOpen = lines[i]!.match(FENCE_OPEN_ANY)
        if (anyOpen) {
            const closeAt = findFenceClose(lines, i + 1, anyOpen[1]!.length)
            out.push(lines[i]!)
            if (closeAt === -1) {
                out.push(...lines.slice(i + 1))
                break
            }
            out.push(...lines.slice(i + 1, closeAt + 1))
            i = closeAt
            continue
        }
        out.push(lines[i]!)
    }
    return out.join('\n')
}

/**
 * 从 code 组件的 info string 反解 fence 身份序号；无 token 或非 openui fence → null
 * （非 TextBlock 渲染路径不注解，anchor 退回 block 级——现状行为）。
 */
export function parseFenceIndexToken(lang: string | undefined): number | null {
    if (!lang || !/^openui(?:-lang)?(?:\s|$)/.test(lang)) return null
    const m = lang.match(FENCE_TOKEN_BOUNDED_RE)
    if (!m) return null
    const n = Number.parseInt(m[1]!, 10)
    return Number.isFinite(n) ? n : null
}
