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

import type { App } from 'antd'
import axios from 'axios'
import type { QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { MobiApi } from '@/core/data/api/client'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'

type AppMessage = ReturnType<typeof App.useApp>['message']

export interface DormancyActionDeps {
    api: MobiApi
    queryClient: QueryClient
    t: TFunction
    /** App.useApp() 的 message 实例：反馈 toast 与 modal 同走主题上下文，不用静态方法 */
    message: AppMessage
}

/** 从 axios 错误中提取 409 携带的逐项 blocker code（非 axios / 无字段返回空）。
 *  休眠与删除两路共用：删除 active 会话时 daemon 会先自动休眠，被 gate 阻塞的 409
 *  同样携带 blockers（结构同源） */
export function extractBlockers(error: unknown): string[] {
    return axios.isAxiosError(error)
        ? (error.response?.data as { blockers?: string[] } | undefined)?.blockers ?? []
        : []
}

/** blocker code 列表 → 「无法…：reasons」完整文案。分隔符走 i18n——中文顿号、
 *  英文逗号是各 locale 自己的排版约定，不硬编码（2026-09-25 review）；
 *  blockedKey 缺省休眠文案，删除场景传 session.actions.deleteBlocked */
export function dormancyBlockedText(blockers: string[], t: TFunction, blockedKey = 'session.dormancy.blocked'): string {
    const reasons = blockers
        .map((b) => t(`session.dormancy.blocker.${b}`, b))
        .join(t('session.dormancy.blockerSeparator'))
    return t(blockedKey, { reasons })
}

export interface BlockedErrorReport {
    /** 409 blockers 时的逐项文案键（缺省休眠 blocked） */
    blockedKey?: string
    /** 非 blocker 失败的通用文案键（缺省休眠 failed） */
    fallbackKey?: string
    /** 非 blocker 失败的 toast 档位（缺省 warning；归档入口传 'error'） */
    fallbackVariant?: 'warning' | 'error'
}

/**
 * gate 阻塞类动作失败的 toast 反馈收口（休眠 / 归档三入口此前各抄一遍
 * extract→判空→定档三连）：409 blockers → warning 逐项原因（用户可自行处理后
 * 重试，warning 档更贴语义）；其余失败 → fallback 档位 + 文案。
 */
export function reportBlockedError(
    message: AppMessage,
    t: TFunction,
    error: unknown,
    opts: BlockedErrorReport = {},
): void {
    const blockers = extractBlockers(error)
    if (blockers.length > 0) {
        void message.warning(dormancyBlockedText(blockers, t, opts.blockedKey ?? 'session.dormancy.blocked'))
        return
    }
    const fallbackKey = opts.fallbackKey ?? 'session.dormancy.failed'
    if (opts.fallbackVariant === 'error') void message.error(t(fallbackKey))
    else void message.warning(t(fallbackKey))
}

/**
 * 删除入口的阻塞文案组合（PC/移动端删除失败 catch 共用，extract→判空→定 key 三步
 * 单点收口）：409 blockers（daemon 删除前自动休眠被 gate 挡）→「无法删除：…」；
 * 非阻塞错误返回 null，调用方自行决定回退（PC 通用错误 toast / 移动端静默）。
 */
export function deleteBlockedText(error: unknown, t: TFunction): string | null {
    const blockers = extractBlockers(error)
    return blockers.length > 0 ? dormancyBlockedText(blockers, t, 'session.actions.deleteBlocked') : null
}

/**
 * 手动休眠动作流（dormancy spec §D.11）：调 API → 成功 toast + 失效会话视图。
 * gate 阻塞（409 blockers）→ 逐项展示阻塞原因，不提供强制退出路径（close 语义已作废，
 * spec session-retention 票 01）；非 blocker 失败 → 通用文案 toast。
 * 侧边栏 / 移动端列表共用，调用方只管 pending 态。
 */
export async function dormantSessionWithFeedback(
    deps: DormancyActionDeps,
    sessionId: string,
    onDone: () => void,
): Promise<void> {
    const { api, queryClient, t, message } = deps
    try {
        await api.sessions.dormant(sessionId)
        void message.success(t('common.success'))
        await invalidateSessionViews(queryClient, [sessionId])
    } catch (error) {
        reportBlockedError(message, t, error)
    } finally {
        onDone()
    }
}
