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

/** 消息行的上游 native 事实（与 DecryptedMessage.metadata 同构，web 侧独立声明——hub DTO 线并行） */
export type NativeMessageMetadata = {
    nativeId?: string
    nativeSessionId?: string
}

/** 判据入参的最小消息形状 */
export type RewindableMessage = {
    metadata?: NativeMessageMetadata | null
}

/** 会话侧状态（running 来自 session DTO；backgroundTasks 计数来自 backgroundTasksStore） */
export type RewindSessionState = {
    running: boolean
    backgroundTasks: number
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
): boolean {
    // 在途工作（前台 running / 后台任务）期间禁止 rewind
    if (sessionState.running || sessionState.backgroundTasks > 0) return false
    // 会话侧 native session 未知（老数据 / 尚未上报）→ 保守不可
    if (!sessionNativeSessionId) return false
    // 消息无 native 锚点（!bash 本地执行 / messages-bound 丢失）→ 不可
    if (!message.metadata?.nativeId || !message.metadata.nativeSessionId) return false
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
