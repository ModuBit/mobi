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
 * 流式工具入参预览（单一来源）
 *
 * 模型流式生成 tool_use 入参时（input_json_delta 逐片到达），对半截 JSON 做
 * 「尽力解析」：提取已完整闭合的标识性短字段（file_path / command / plan…），
 * 让前端工具卡从生成早期就有内容，而不是等整个入参 JSON 生成完。
 *
 * 设计口径（与 ZCode streaming-tool-input-preview 的差异见
 * docs/research-zcode-interactions.md §1.1）：
 * - 只抓短标识字段，**不抓大 payload**（content / new_string 等）——卡片有标识
 *   就够，巨量文本只该出现在 tool_result 阶段；
 * - 字段顺序红利：file_path / command 几乎总排在 content 之前，生成早期即可命中；
 * - 8KB 扫描窗口：解析只看前 8KB——一是封住解析成本，二是 Write 等 content 巨大
 *   的工具在 content 开始流之后预览自动让位（回退空预览，不比现状更差）。
 *
 * 审批安全：预览只进展示层。审批请求只在 input 完整后发起，审批路径拿到的
 * 永远是完整 input（StreamSnapshotSender 的 ready 翻转语义保证）。
 */

/** 预览抓取的字段白名单（单一声明处；新增工具的展示需求只改这里） */
const STREAMING_PREVIEW_FIELD_KEYS = [
    'file_path',
    'filePath',
    'path',
    'notebook_path',
    'command',
    'description',
    'pattern',
    'plan',
    'title',
    'name',
    'url',
    'script',
] as const

/** 扫描窗口上限：rawInput 超过后放弃解析（解析成本封顶 + 大 payload 让位） */
export const STREAMING_PREVIEW_MAX_RAW_LENGTH = 8 * 1024

/** 单字段值截断上限（展示层本有 ellipsis，这里是协议流量兜底） */
export const STREAMING_PREVIEW_MAX_FIELD_LENGTH = 2048

export type ParseCompleteJsonResult = { ok: true; value: unknown } | { ok: false }

/** 完整 JSON 尝试解析（供调用方优先走完整路径；失败再走半截提取） */
export function parseCompleteJson(raw: string): ParseCompleteJsonResult {
    if (!raw) return { ok: false }
    try {
        return { ok: true, value: JSON.parse(raw) }
    } catch {
        return { ok: false }
    }
}

export type StreamingToolInputPreview = {
    /** 部分解析结果（complete=false 时是白名单字段的尽力提取，可能是 {}） */
    input: unknown
    /** rawInput 是否为完整 JSON（true 时 input 即完整解析结果） */
    complete: boolean
}

/**
 * 对流式累积中的工具入参做尽力解析预览。
 *
 * 提取规则：在扫描窗口（前 8KB）内，对每个白名单字段匹配「键 + 完整闭合的字符串值」
 * （正则消费转义序列，值内 \" \n 等转义不误判闭合）；值做 JSON.unescape 后截断到上限。
 * 未闭合的字段跳过（下次 delta 到达后重算）。
 */
export function buildStreamingToolInputPreview(raw: string): StreamingToolInputPreview {
    const complete = parseCompleteJson(raw)
    if (complete.ok) {
        return { input: complete.value, complete: true }
    }

    // 只扫前 8KB：大 payload 工具（content 巨大）在 content 开始流之后预览自动让位
    const window = raw.length > STREAMING_PREVIEW_MAX_RAW_LENGTH
        ? raw.slice(0, STREAMING_PREVIEW_MAX_RAW_LENGTH)
        : raw

    const input: Record<string, string> = {}
    for (const key of STREAMING_PREVIEW_FIELD_KEYS) {
        // 值匹配消费转义序列（\\" 算两字符），只在真实未转义的 " 处闭合
        const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)
        const m = re.exec(window)
        if (!m) continue
        let value: string
        try {
            // 提取的是 JSON 字符串字面量内容，反转义还原真实值
            value = JSON.parse(`"${m[1]}"`) as string
        } catch {
            continue
        }
        input[key] = value.length > STREAMING_PREVIEW_MAX_FIELD_LENGTH
            ? value.slice(0, STREAMING_PREVIEW_MAX_FIELD_LENGTH)
            : value
    }
    return { input, complete: false }
}
