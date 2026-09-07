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

import type { ForkErrorMetadata, Session } from '@/core/data/api/types'

type TFunction = (key: string, options?: Record<string, unknown>) => string

/**
 * fork 会话行的列表呈现（fork-session spec §4.3）：
 * - metadata.forkFrom 在场 = 未激活（激活成功后 hub 清除、SSE session-updated 驱动缓存更新即消失）
 * - metadata.forkError 在场 = 激活失败错误态（叠加在 forkFrom 之上，spec §5.3）
 * - 标题由 hub 建行时落库（metadata.name = 「〈parent 标题〉 · 分叉」，写入时冻结），
 *   web 侧不拼接——走 getSessionDisplayName 的 name 优先路径自然命中
 *
 * 状态只依赖 session 自身 metadata，走纯函数 resolveForkSessionState；fork 行零额外查询。
 */

/** 激活失败原因码 → 展示文案（未知码回退通用文案；code 集合见 shared FORK_ERROR_CODES。
 * 三个稳定码各自成文案：transcript 缺失（换机/文件丢失）与父会话回退（需回父会话重新分叉）
 * 恢复方式不同，不得共用） */
export function resolveForkErrorText(forkError: ForkErrorMetadata, t: TFunction): string {
    switch (forkError.code) {
        case 'anchor-invalidated':
            return t('session.fork.errorReason.anchorInvalidated')
        case 'parent-transcript-missing':
            return t('session.fork.errorReason.parentTranscriptMissing')
        case 'activation-failed':
            return t('session.fork.errorReason.activationFailed')
        default:
            return t('session.fork.errorReason.unknown')
    }
}

export type ForkSessionRowState = {
    /** 是否 fork 行（forkFrom 或 forkedFrom 在场——forkFrom 激活即清除，持久区分靠终身
     *  保留的 forkedFrom；否则激活后「· 分叉」后缀消失、与 parent 标题无法区分） */
    isForkRow: boolean
    /** 待激活态（forkFrom 在场且无 forkError） */
    isPendingActivation: boolean
    /** 激活失败错误态（forkError 在场） */
    isActivationFailed: boolean
    /** 错误态 tooltip 文案（非错误态为 null） */
    errorText: string | null
}

/** 非 fork 行的统一返回（避免调用方判空分支重复） */
const NON_FORK_STATE: ForkSessionRowState = {
    isForkRow: false,
    isPendingActivation: false,
    isActivationFailed: false,
    errorText: null,
}

/**
 * fork 行徽标状态（纯函数，只读 session 自身 metadata，独立导出便于单测）。
 * forkFrom 存废驱动待激活/错误态徽标：hub 激活清除 forkFrom（SSE 到达）→ 徽标消失；
 * 激活失败写入 forkError → 徽标转错误态。isForkRow 另含 forkedFrom（终身保留）——
 * 已激活的分叉会话仍是 fork 行（标题后缀「· 分叉」的依据）。
 */
export function resolveForkSessionState(session: Session, t: TFunction): ForkSessionRowState {
    const forkFrom = session.metadata?.forkFrom
    const forkedFrom = session.metadata?.forkedFrom
    const forkError = session.metadata?.forkError
    if (!forkFrom && !forkedFrom) return NON_FORK_STATE
    return {
        isForkRow: true,
        isPendingActivation: !!forkFrom && !forkError,
        isActivationFailed: Boolean(forkError),
        errorText: forkError ? resolveForkErrorText(forkError, t) : null,
    }
}
