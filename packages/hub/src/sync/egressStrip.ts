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

import { isObject } from '@mobi/shared'
import { isRoleWrappedRecord } from '@mobi/shared/messages'
import { TASK_TOOL_NAMES } from './tasks'

/**
 * 出口剥离（egress strip）：消息行离开 hub 供 web 消费时按工具策略对 tool_result
 * 重内容做的展示层瘦身。存储层始终是完整事实，剥离只作用于消费边界且不可变——
 * 术语见 packages/hub/CONTEXT.md「出口剥离」。
 *
 * 策略四条（spec: .scratch/tool-result-egress-strip/spec.md D6）：
 * 1. 文件类工具（内容可从磁盘重建）→ content 替换为占位
 * 2. 其余工具 → content 截断到 2048 字符（≤2048 原样，小结果零感知；未知工具/新
 *    SDK 工具自动落入此默认，无需维护工具清单）
 * 3. Task 族豁免——hub 投影与 web TaskTextView 都消费其结果，且输出小
 * 4. is_error 豁免——失败结果是排障关键
 *
 * 另收编 base64 图片数据剥离（原 messageService.stripHeavyImagePayload）。
 */

/** base64 图片数据剥离后的占位符：保留「此处曾有数据」的可追溯性，代价 22 字节 */
export const STRIPPED_BASE64_MARKER = '[mobi:base64-stripped]'

/** 文件类工具结果占位：内容可从磁盘重建（文件 Chip → inspector / read-file URL） */
export const EGRESS_PLACEHOLDER = '[file content omitted — open via file chip]'

/** 非「磁盘可重建」工具的结果截断阈值（字符）：约 40-60 行代码/测试摘要，测试结论与报错头部都在前 50 行内 */
export const EGRESS_TRUNCATE_CHARS = 2048

/** 文件类工具：结果内容可从磁盘当前状态重建，出口占位无损 */
const FILE_TOOL_NAMES = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookRead', 'NotebookEdit'])

// ============ 工具名注册表 ============

/**
 * tool_use_id → tool_name 的模块级 LRU。tool_result 消息本身不带工具名（tool_use
 * 在前一条 assistant 消息里），assistant 帧过出口时顺带登记，tool_result 帧查询。
 *
 * id 是 UUID 全局唯一，无需分会话。重启后冷表 → 查不到名按「截断」兜底：截断是保守
 * 降级（宁漏剥勿误剥——Task 族老消息被截断只影响展示，不破坏任何语义），不落盘。
 */
const TOOL_NAME_REGISTRY_CAPACITY = 10_000
const toolNameRegistry = new Map<string, string>()

export function registerEgressToolName(toolUseId: string, toolName: string): void {
    // 删后再插：既去重又刷新 LRU 新鲜度
    toolNameRegistry.delete(toolUseId)
    toolNameRegistry.set(toolUseId, toolName)
    if (toolNameRegistry.size > TOOL_NAME_REGISTRY_CAPACITY) {
        const oldest = toolNameRegistry.keys().next().value
        if (oldest !== undefined) toolNameRegistry.delete(oldest)
    }
}

export function lookupEgressToolName(toolUseId: string): string | null {
    // 不做查即刷新（delete+set）：配对窗口最多隔一条消息，容量内基本不可能被淘汰，
    // 多余的聪明不值得热路径上的两次 Map 变异
    return toolNameRegistry.get(toolUseId) ?? null
}

// ============ 剥离策略 ============

/**
 * tool_result block 的 content 截断（保留块结构）：text 块按剩余预算截断、超预算的丢弃；
 * 非 text 块（image 等）原样保留——其重数据已由 base64 剥离处理。
 * 先无分配地探测总文本量，未超预算直接返回 null（常见路径零分配）。
 */
function truncateToolResultContent(content: unknown): unknown {
    if (typeof content === 'string') {
        return content.length > EGRESS_TRUNCATE_CHARS ? content.slice(0, EGRESS_TRUNCATE_CHARS) : null
    }
    if (!Array.isArray(content)) return null

    const totalText = content.reduce(
        (n, part) => n + (isObject(part) && typeof part.text === 'string' ? part.text.length : 0),
        0,
    )
    if (totalText <= EGRESS_TRUNCATE_CHARS) return null

    let remaining = EGRESS_TRUNCATE_CHARS
    const out: unknown[] = []
    for (const part of content) {
        if (isObject(part) && typeof part.text === 'string') {
            if (remaining <= 0) continue
            if (part.text.length > remaining) {
                out.push({ ...part, text: part.text.slice(0, remaining) })
                remaining = 0
                continue
            }
            remaining -= part.text.length
            out.push(part)
            continue
        }
        out.push(part)
    }
    return out
}

/** 单个 tool_result block 的出口形态：返回 null = 不需要改 */
function stripToolResultBlock(block: Record<string, unknown>): Record<string, unknown> | null {
    if (!('content' in block)) return null

    // 先剥 image base64（Read 读图时同张图存两份之二），截断的字符预算只数文本。
    // 无条件执行——is_error 豁免保的是排障文本，失败帧附带的错误截图同样是死重。
    // COW：无 image 时不分配新数组
    let next = block
    let content: unknown[] | null = Array.isArray(block.content) ? block.content : null
    if (content) {
        for (let i = 0; i < content.length; i++) {
            const innerBlock = content[i]
            if (!isObject(innerBlock) || innerBlock.type !== 'image') continue
            const source = innerBlock.source
            if (!isObject(source) || source.type !== 'base64' || typeof source.data !== 'string') continue
            if (content === block.content) content = [...content]
            content[i] = { ...innerBlock, source: { ...source, data: STRIPPED_BASE64_MARKER } }
        }
        if (content !== block.content) next = { ...block, content }
    }

    // is_error 豁免（排障关键）：只豁免占位/截断策略，base64 死重已在上方剥离
    if (block.is_error === true) return next !== block ? next : null

    const toolName = typeof block.tool_use_id === 'string' ? lookupEgressToolName(block.tool_use_id) : null
    if (toolName !== null && TASK_TOOL_NAMES.has(toolName)) return next !== block ? next : null

    if (toolName !== null && FILE_TOOL_NAMES.has(toolName)) {
        return { ...next, content: [{ type: 'text', text: EGRESS_PLACEHOLDER }] }
    }

    const truncated = truncateToolResultContent(next.content)
    if (truncated !== null) return { ...next, content: truncated }
    return next !== block ? next : null
}

/**
 * tool_use_result 的重内容字段（web 无消费方的死重）：stdout/stderr 截断保留头部、
 * file.content 占位（磁盘可重建）、file.base64 剥离。结构化字段（structuredPatch /
 * agentMetrics / filePath 等）不动。返回 null = 不需要改。
 */
function stripToolUseResult(tur: Record<string, unknown>): Record<string, unknown> | null {
    let patch: Record<string, unknown> | null = null

    for (const key of ['stdout', 'stderr'] as const) {
        const value = tur[key]
        if (typeof value === 'string' && value.length > EGRESS_TRUNCATE_CHARS) {
            patch ??= { ...tur }
            patch[key] = value.slice(0, EGRESS_TRUNCATE_CHARS)
        }
    }

    if (isObject(tur.file)) {
        const file = tur.file
        const patchFile: Record<string, unknown> = {}
        // file.content：Read 读文本文件时同份内容存两份之一（另一份在 tool_result block，
        // 已按策略剥离），文件类可从磁盘重建 → 占位
        if (typeof file.content === 'string') patchFile.content = EGRESS_PLACEHOLDER
        // file.base64：Read 读图时的图片载荷
        if (typeof file.base64 === 'string') patchFile.base64 = STRIPPED_BASE64_MARKER
        if (Object.keys(patchFile).length > 0) {
            patch ??= { ...tur }
            patch.file = { ...file, ...patchFile }
        }
    }

    return patch
}

/**
 * 出口剥离唯一入口。未命中任何规则时返回原引用（零拷贝）；命中时沿访问路径浅拷贝
 * 产出新对象，绝不原地改写——StoredMessage 同进程内有其他引用（合并批次、缓存），
 * 出口函数不得依赖「每次查询重新 parse」的实现细节。
 */
export function stripEgressContent<T>(content: T): T {
    // 信封形态守卫：只处理顶层 role-wrapped 的 agent transcript 帧（{role, content:{type,data}}）。
    // 非顶层命中的包裹形态（value.message / value.data.message）不支持写回，原样返回
    if (!isRoleWrappedRecord(content)) return content
    const inner = isObject(content.content) ? content.content : null
    const data = inner !== null && isObject(inner.data) ? inner.data : null
    if (!data) return content

    // 惰性拷贝：绝大多数消息不命中任何剥离路径，命中前不复制（/messages 页数百条/页的白重 spread）
    let patch: Record<string, unknown> | null = null

    // 1) tool_use_result 重内容（死重字段截断/占位，结构化字段不动）
    const tur = data.tool_use_result
    const turPatch = isObject(tur) ? stripToolUseResult(tur) : null
    if (turPatch !== null) (patch ??= { ...data }).tool_use_result = turPatch

    // 2) message.content 块数组：assistant tool_use 登记 + tool_result 策略剥离（含 image base64）。
    //    COW：无块变更时不分配新数组（/messages 页上多数帧走这条零拷贝路径）
    const message = data.message
    if (isObject(message) && Array.isArray(message.content)) {
        let out: unknown[] | null = null
        for (let i = 0; i < message.content.length; i++) {
            const block = message.content[i]
            let next: unknown = block
            if (isObject(block)) {
                // assistant tool_use：登记工具名供后续 tool_result 配对（同一次遍历，零额外开销）
                if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
                    registerEgressToolName(block.id, block.name)
                } else if (block.type === 'tool_result') {
                    next = stripToolResultBlock(block) ?? block
                }
            }
            if (next !== block) {
                out ??= [...message.content]
                out[i] = next
            }
        }
        if (out !== null) (patch ??= { ...data }).message = { ...message, content: out }
    }

    if (patch === null) return content
    return { ...(content as object), content: { ...inner, data: patch } } as T
}
