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
 * 归档页批量操作（session-retention 票 08）：逐条执行 + 结果聚合。
 * daemon 无批量端点——前端循环单条调用；单条失败不回滚整批，逐条记录结果，
 * 由调用方聚合报告（成功条目已生效，失败条目带原因）。
 */

import type { TFunction } from 'i18next'
import type { Session } from '@/core/data/api/types'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'

export interface BatchItemResult {
    sessionId: string
    name: string
    ok: boolean
    /** 失败原因（blockers 文案或通用错误），仅 ok=false 时有值 */
    reason?: string
}

/**
 * 串行执行批量动作：逐条 await（删除带级联清理，不并发压 daemon）；
 * 单条抛错被捕获记为失败项，不中断整批。每条成功后回调 onSuccess
 * （缓存清理等即时生效动作）。
 */
export async function runBatch(
    sessions: Session[],
    action: (sessionId: string) => Promise<unknown>,
    onSuccess?: (sessionId: string) => void,
): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = []
    for (const session of sessions) {
        try {
            await action(session.id)
            onSuccess?.(session.id)
            results.push({ sessionId: session.id, name: getSessionDisplayName(session), ok: true })
        } catch (error) {
            results.push({ sessionId: session.id, name: getSessionDisplayName(session), ok: false, reason: String(error) })
        }
    }
    return results
}

/** 批量确认输入的匹配值：组级 = 工作区名（空组名 / 未分组 → DELETE），页面级 = DELETE */
export function batchConfirmExpected(scope: { kind: 'group'; groupName: string } | { kind: 'page' }): string {
    return scope.kind === 'group' && scope.groupName.trim().length > 0
        ? scope.groupName.trim()
        : 'DELETE'
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
