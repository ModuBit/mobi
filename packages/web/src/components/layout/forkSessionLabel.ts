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

import { useTranslation } from 'react-i18next'
import type { ForkErrorMetadata, Session } from '@/core/data/api/types'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'

type TFunction = (key: string, options?: Record<string, unknown>) => string

/**
 * fork 会话行的列表呈现（fork-session spec §4.3）：
 * - metadata.forkFrom 在场 = 未激活（激活成功后 hub 清除、SSE session-updated 驱动缓存更新即消失）
 * - metadata.forkError 在场 = 激活失败错误态（叠加在 forkFrom 之上，spec §5.3）
 * - 标题自动命名「〈parent 标题〉 · 分叉」，parent 标题实时取（useSession 查询单会话），
 *   取不到（已删/加载中）降级「分叉会话」
 *
 * 徽标状态（pending/error/错误文案）只依赖 session 自身 metadata，走纯函数 resolveForkSessionState；
 * 依赖查询的只有 parent 标题（useForkRowTitle）——两入口分离，非 fork 行零查询开销。
 */

/** 激活失败原因码 → 展示文案（未知码回退通用文案；code 集合见 shared FORK_ERROR_CODES） */
export function resolveForkErrorText(forkError: ForkErrorMetadata, t: TFunction): string {
    switch (forkError.code) {
        case 'anchor-invalidated':
        case 'parent-transcript-missing':
            return t('session.fork.errorReason.anchorInvalidated')
        case 'activation-failed':
            return t('session.fork.errorReason.activationFailed')
        default:
            return t('session.fork.errorReason.unknown')
    }
}

export type ForkSessionRowState = {
    /** 是否 fork 行（forkFrom 在场） */
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
 * forkError 的存废即徽标切换依据：hub 激活清除 forkFrom（SSE 到达）→ 徽标消失；
 * 激活失败写入 forkError → 徽标转错误态。
 */
export function resolveForkSessionState(session: Session, t: TFunction): ForkSessionRowState {
    const forkFrom = session.metadata?.forkFrom
    const forkError = session.metadata?.forkError
    if (!forkFrom) return NON_FORK_STATE
    return {
        isForkRow: true,
        isPendingActivation: !forkError,
        isActivationFailed: Boolean(forkError),
        errorText: forkError ? resolveForkErrorText(forkError, t) : null,
    }
}

/**
 * fork 行标题（纯函数）：「〈parent 标题〉 · 分叉」。parentSession 实时取失败
 * （已删/未加载）时降级「分叉会话」（spec §4.3）。
 */
export function resolveForkRowTitle(parentSession: Session | null | undefined, t: TFunction): string {
    const parentTitle = parentSession ? getSessionDisplayName(parentSession) : null
    return parentTitle
        ? t('session.fork.forkName', { name: parentTitle })
        : t('session.fork.pendingFallback')
}

/**
 * fork 行标题 hook：实时取 parent 会话（SSE session-updated/removed 驱动缓存失效，
 * parent 改名/删除后标题自动跟随/降级）。只应挂载在 fork 行上（非 fork 行零开销）。
 */
export function useForkRowTitle(forkSession: Session): string {
    const { t } = useTranslation()
    const parentSessionId = forkSession.metadata?.forkFrom?.parentSessionId ?? null
    const { data: parentSession } = useSession(parentSessionId)
    return resolveForkRowTitle(parentSession, t)
}
