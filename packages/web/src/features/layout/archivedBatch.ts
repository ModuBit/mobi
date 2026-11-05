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
 * 归档页批量操作的展示侧逻辑（session-retention 票 08）：确认输入匹配值 + 结果聚合。
 * 批量执行归 daemon 批量端点（DELETE /sessions/archived、POST /sessions/archived/unarchive），
 * 前端只负责把逐条结果译成可读文案——不在这里做扇出。
 */

import type { TFunction } from 'i18next'

export interface BatchItemResult {
    sessionId: string
    name: string
    ok: boolean
    /** 失败原因（blockers 文案或通用错误），仅 ok=false 时有值 */
    reason?: string
}

/** 页面级批量删除的确认令牌：无组名可比对时的固定输入值；i18n 文案 typeDelete 以
 *  {{token}} 插值引用同一常量，措辞与匹配值不再双源 */
export const BATCH_DELETE_CONFIRM_TOKEN = 'DELETE'

/** 批量确认输入的匹配值：组级 = 工作区名（空组名 / 未分组 → DELETE），页面级 = DELETE */
export function batchConfirmExpected(scope: { kind: 'group'; groupName: string } | { kind: 'page' }): string {
    return scope.kind === 'group' && scope.groupName.trim().length > 0
        ? scope.groupName.trim()
        : BATCH_DELETE_CONFIRM_TOKEN
}

/**
 * 批量结果聚合文案：全成功一句（actionLabel + 条数）；有失败补逐条原因
 * （name: reason，换行列出）。文案键由调用方传（删除 / 取消归档各自措辞）。
 */
export function summarizeBatch(
    results: BatchItemResult[],
    t: TFunction,
    labels: { successKey: string; failedKey: string },
): string {
    const okCount = results.filter(r => r.ok).length
    const failed = results.filter(r => !r.ok)
    const lines = [t(labels.successKey, { count: okCount })]
    for (const f of failed) {
        lines.push(t(labels.failedKey, { name: f.name, reason: f.reason ?? '' }))
    }
    return lines.join('\n')
}
