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
 * SDK resume-drops-turn refusal 检测（spec E1）。
 *
 * SDK 0.3.223 `resumeDropsTurn` 配对 `resumeSessionAt`：CLI fork 时校验截断区间
 * 只含该 turn；含其他（队列消息/任务通知）则 refusal——`error_during_execution`
 * result 或 startup 抛错，message 以 `Resume rejected by --resume-drops-turn:` 开头。
 * refusal 是 deterministic，重发必败，host 应 clear pending + plain resume（保留证据）。
 */

/** SDK refusal 前缀（spec E1）：截断区间含未观察内容时 SDK 拒绝截断 */
export const REWIND_REFUSAL_PREFIX = 'Resume rejected by --resume-drops-turn:'

/**
 * 判别 SDK resume-drops-turn refusal（startup 抛错或 result is_error message）。
 * 用 startsWith 而非全等——SDK 可能在前缀后附加具体原因。
 */
export function isRewindRefusalError(error: unknown): boolean {
    if (!error) return false
    const msg = error instanceof Error ? error.message : String(error)
    return msg.startsWith(REWIND_REFUSAL_PREFIX)
}

/**
 * 从 SDK result 消息提取 refusal 文本（路径 B：startup 成功但首个 result 是 refusal error）。
 * SDKResultError.errors 数组是标准路径；result 字段是防御性分支——某些非标准 error
 * 形状可能把错误文本放在 result 而非 errors，is_error:true 守卫已确保只检 error result。
 * 返回匹配到的 refusal 文本，非 refusal result 返回 null。
 */
export function extractRewindRefusalFromResult(result: {
    is_error?: boolean
    errors?: string[]
    result?: string
}): string | null {
    if (!result.is_error) return null
    // SDKResultError: errors 数组（标准路径）
    if (Array.isArray(result.errors)) {
        for (const e of result.errors) {
            if (typeof e === 'string' && e.startsWith(REWIND_REFUSAL_PREFIX)) return e
        }
    }
    // 防御性分支：非标准 error 形状可能把错误文本放在 result 字段
    if (typeof result.result === 'string' && result.result.startsWith(REWIND_REFUSAL_PREFIX)) {
        return result.result
    }
    return null
}

/**
 * refusal recovery 依赖（launcher 注入，便于单测）。
 * 路径 A（pendingRewind 非空）：clear + emitRewindCompleted(false) — web store progress 条目仍在，
 *   corrective 有效。claudeRemote 已 return，while 循环继续 → 常规轮 plain resume。
 * 路径 B（pendingRewind 已空）：onRewindTruncated 已发 success + 删 progress 条目。
 *   T7 三分守卫已允许 corrective 覆盖（无 progress 但有 completion → 覆盖），故
 *   emitRewindCompleted(false) 能正确改写终态。sendSessionEvent 保留作 belt-and-suspenders：
 *   终态分隔线不显 error 文本时仍可见 refusal 原因（见 buildBubbleItems rewind-completed 渲染）。
 */
export interface RewindRefusalHandlerDeps {
    /** 当前 pendingRewind（路径 A 非空，路径 B 已空） */
    pendingRewind: unknown
    /** 清空 pendingRewind（路径 A 专用，launcher 注入 session.pendingRewind = null） */
    clearPendingRewind: () => void
    /** 上报 rewind 终态（false = 失败，携带 error 文本） */
    emitRewindCompleted: (filesRestored: boolean, error?: string) => void
    /** 发送 session 事件（路径 B belt-and-suspenders，终态分隔线不显 error 时仍可见 refusal 原因） */
    sendSessionEvent: (event: { type: 'message'; message: string }) => void
}

/**
 * rewind refusal recovery 分流（路径 A/B）。
 *
 * 路径 A（startup 抛错，pendingRewind 非空）：clear + emitRewindCompleted(false)，
 *   不发 sendSessionEvent（progress 条目仍在，corrective emit 有效，无需兜底）。
 * 路径 B（首个 result is_error，pendingRewind 已空）：emitRewindCompleted(false) +
 *   sendSessionEvent belt-and-suspenders（T7 三分守卫已允许 corrective 覆盖，emit 即生效；
 *   sendSessionEvent 确保终态分隔线不显 error 文本时仍可见 refusal 原因）。
 */
export function handleRewindRefusal(deps: RewindRefusalHandlerDeps, msg: string): void {
    if (deps.pendingRewind) {
        // 路径 A：clear + emit（progress 条目仍在，corrective 有效）
        deps.clearPendingRewind()
        deps.emitRewindCompleted(false, `rewind rejected: ${msg}`)
    } else {
        // 路径 B：onRewindTruncated 已发 success，progress 条目已删。
        // T7 三分守卫已允许 corrective 覆盖（无 progress 但有 completion → 覆盖），emitRewindCompleted
        // 能正确改写终态分隔线为失败文案。sendSessionEvent 作 belt-and-suspenders：终态分隔线
        // 不显 error 文本时仍可见 refusal 原因（见 buildBubbleItems rewind-completed 渲染）。
        deps.emitRewindCompleted(false, `rewind rejected: ${msg}`)
        deps.sendSessionEvent({ type: 'message', message: `rewind rejected: ${msg}` })
    }
}
