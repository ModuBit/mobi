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
 * rewind 域纯函数（无 React / store 依赖，PC footer 与移动 Drawer 两入口共用）。
 * 判据语义见 spec §3.4：行冗余 nativeSessionId 与会话当前值一致 = 同一 transcript 链，
 * 天然识别 /clear（及其它换 session 场景）之前的消息。
 */

import type { NativeMessageMetadata } from '@mobi/shared'

export type { NativeMessageMetadata }

/** 判据入参的最小消息形状 */
export type RewindableMessage = {
    metadata?: NativeMessageMetadata | null
}

/** 会话侧状态（running/active 来自 session DTO；backgroundTasks 计数来自 backgroundTasksStore；
 *  rewinding 来自 rewindStore 进行中态——截断等待窗口内互斥其余 rewind 入口） */
export type RewindSessionState = {
    running: boolean
    backgroundTasks: number
    /** rewind 进行中（POST 受理 → rewind-completed）→ 互斥再次触发 */
    rewinding?: boolean
    /** 会话激活（CLI 在线）；false = 离线，rewind RPC 无法送达 → 隐藏入口；undefined = 不可判定（保守不隐藏） */
    active?: boolean
}

/**
 * rewind 入口显隐判据（PC footer 操作组 / 移动长按 Drawer 共用）。
 *
 * 体验层：可能因数据未对齐而误判——误判方向只会隐藏入口（保守），
 * 放行侧由 Hub 闸门（后台任务集合）+ CLI 预检（transcript 锚点存在性）把守。
 */
export function canRewindMessage(
    message: RewindableMessage,
    sessionNativeSessionId: string | undefined | null,
    sessionState: RewindSessionState,
    /** 链首（其前无同链 assistant 行，rewind 锚点不存在，CLI 预检必拒）；undefined = 不可判定（保守不隐藏） */
    isChainHead?: boolean,
): boolean {
    // 在途工作（前台 running / 后台任务 / rewind 截断等待窗口）期间禁止 rewind
    if (sessionState.running || sessionState.backgroundTasks > 0 || sessionState.rewinding) return false
    // 会话未激活（CLI 离线）→ rewind RPC 无法送达，dry-run/POST 必失败，直接隐藏入口
    if (sessionState.active === false) return false
    // 会话侧 native session 未知（老数据 / 尚未上报）→ 保守不可
    if (!sessionNativeSessionId) return false
    // 消息无 native 锚点（!bash 本地执行 / messages-bound 丢失）→ 不可
    if (!message.metadata?.nativeId || !message.metadata.nativeSessionId) return false
    // 未确认（CC 尚未回显接收）→ 假锚点，不可 rewind
    if (!message.metadata.nativeAckAt) return false
    // 链首（会话或 /clear 新链的第一条用户消息）其前无 assistant 锚点 → CLI 预检必拒，直接隐藏
    if (isChainHead) return false
    // 同一 transcript 链才可 rewind（/clear 前旧行 nativeSessionId 不一致）
    return message.metadata.nativeSessionId === sessionNativeSessionId
}

/** 回填行输入（结构化类型：seq 排序锚 + native 锚点 + 原文载体，与 DecryptedMessage 字段同构） */
export type RewindBatchRow = {
    seq: number | null
    metadata?: NativeMessageMetadata | null
    content?: unknown
    originalText?: string
}
/**
 * 锚点批原文收集（spec §4.4）：合并批 1:N 时 rewind 批内任一条 = 整批同删，
 * 回填须取当前窗口中同 metadata.nativeId 的全部用户行，按 seq 升序 join('\n')。
 * 须在 rewindFrom 清窗前调用（这些行随后会被清除）。
 * 文本提取与 QueuedMessagesBar.previewText 同形：content.content.text → originalText 后备。
 */
export function collectRewindBatchText(rows: RewindBatchRow[], nativeId: string): string | null {
    const texts = rows
        .filter(r => r.metadata?.nativeId === nativeId)
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map(r => {
            const c = r.content as { content?: { text?: string } } | null
            return c?.content?.text ?? r.originalText ?? ''
        })
        .filter(text => text.length > 0)
    return texts.length > 0 ? texts.join('\n') : null
}

/** 链首骨架判定的行输入（与 DecryptedMessage 字段同构的最小形状；按 seq 升序传入） */
export type RewindChainRow = {
    id: string
    /** 消息信封（role: 'user' | 'agent' 在 content.role；unknown 直传，内部收窄） */
    content?: unknown
    metadata?: NativeMessageMetadata | null
}

/**
 * 链首用户行 id 集合（spec §3.4 链首 = 其前无同链 assistant 行——rewind 锚点不存在，
 * CLI 预检必拒，前端直接隐藏入口，免掉「点了必失败」的体验断点）：
 *
 * - 同链 = metadata.nativeSessionId 相同（/clear 换链后新链的首条用户行同样是链首）
 * - 1:N 合并批批内无 assistant 分隔 → 整批都算链首（锚点在批前；批前无 assistant 则整批不可退）
 * - assistant 行缺 nativeSessionId（attach 前）无法归属链 → 视为所有链都出现过 assistant：
 *   宁可多显示入口（放行侧由 CLI 预检把守），不误隐藏可退行
 * - 用户行缺 nativeSessionId 已由 canRewindMessage 锚点判据排除，跳过
 *
 * 仅当窗口含全部历史（hasNextPage=false）时可判定——窗口未到头时首条用户行之前
 * 可能还有 assistant 行，须保守不隐藏。
 */
export function collectChainHeadUserRowIds(rows: RewindChainRow[]): Set<string> {
    const seenAssistantChains = new Set<string>()
    // 出现过无法归属链的 assistant 行：所有链保守视为已有 assistant（见上方判定说明）
    let unattributedAssistant = false
    const chainHeads = new Set<string>()
    for (const row of rows) {
        const chain = row.metadata?.nativeSessionId
        const role = (row.content as { role?: string } | null | undefined)?.role
        if (role === 'agent') {
            if (chain) seenAssistantChains.add(chain)
            else unattributedAssistant = true
            continue
        }
        if (role !== 'user' || !chain) continue
        if (!seenAssistantChains.has(chain) && !unattributedAssistant) chainHeads.add(row.id)
    }
    return chainHeads
}

/**
 * dry-run / 执行拒绝 reason → i18n key 判别：链首场景给 /clear 引导文案，
 * busy（多端并发，rewind 已在途）给「回退正在进行中」提示，
 * 其余（假锚点 / 换链旧行等）用笼统 unavailable——CLI reason 是英文串，不直出给用户。
 */
export function rewindRejectReasonKey(reason: string | undefined):
    | 'chat.rewind.firstMessage'
    | 'chat.rewind.inProgress'
    | 'chat.rewind.unavailable' {
    if (reason?.includes('first message')) return 'chat.rewind.firstMessage'
    if (reason?.includes('in progress')) return 'chat.rewind.inProgress'
    return 'chat.rewind.unavailable'
}

/**
 * 文件恢复失败 error → i18n key 判别（终态 filesRestored=false 的部分降态提示）：
 * 边界反查失败（CLI 截断后 Hub 行已不可定位）有明确语义文案，其余笼统提醒检查工作目录。
 * 与 rewindRejectReasonKey 同理：CLI reason 是英文串不直出，原文经 console 留诊断。
 */
export function rewindFilesFailedKey(error: string | undefined): 'chat.rewind.filesFailedBoundary' | 'chat.rewind.filesFailed' {
    return error?.includes('boundary')
        ? 'chat.rewind.filesFailedBoundary'
        : 'chat.rewind.filesFailed'
}

/** 回退目标预览截断长度（字符数，按码点计）：预览只作「回退到哪里」的确认锚点，长文整串渲染无意义 */
const REWIND_PREVIEW_MAX_CHARS = 80

/**
 * 回退目标预览截断：超长原文只展示前 maxChars 个字符 + 省略号。
 * 按码点切（Array.from），避免 emoji 等代理对被从中间截成乱码。
 * 仅用于确认视图预览；回填编辑器的原文走完整 targetText，不受此影响。
 */
export function truncateRewindPreview(text: string, maxChars: number = REWIND_PREVIEW_MAX_CHARS): string {
    const chars = Array.from(text)
    return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join('')}…`
}
