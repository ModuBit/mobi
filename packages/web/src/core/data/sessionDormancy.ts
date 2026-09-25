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

type AppModal = ReturnType<typeof App.useApp>['modal']
type AppMessage = ReturnType<typeof App.useApp>['message']

export interface DormancyActionDeps {
    api: MobiApi
    queryClient: QueryClient
    t: TFunction
    /** App.useApp() 的 modal 实例：gate 阻塞时承载「仍要退出」确认弹窗（受主题上下文） */
    modal: AppModal
    /** App.useApp() 的 message 实例：反馈 toast 与 modal 同走主题上下文，不用静态方法 */
    message: AppMessage
}

/** 从 axios 错误中提取 409 携带的逐项 blocker code（非 axios / 无字段返回空） */
function extractBlockers(error: unknown): string[] {
    return axios.isAxiosError(error)
        ? (error.response?.data as { blockers?: string[] } | undefined)?.blockers ?? []
        : []
}

/** blocker code 列表 → 「无法休眠：…」完整文案（i18n 单源，成功路径与错误转述共用） */
function dormancyBlockedText(blockers: string[], t: TFunction): string {
    const reasons = blockers.map((b) => t(`session.dormancy.blocker.${b}`, b)).join('、')
    return t('session.dormancy.blocked', { reasons })
}

/**
 * 手动休眠动作流（dormancy spec §D.11）：调 API → 成功 toast + 失效会话视图。
 * gate 阻塞（409 blockers）→ 确认弹窗给出「仍要退出」强制兜底（archive，无 gate
 * 直杀进程）；取消或非 blocker 失败 → 文案 toast。侧边栏 / 移动端列表共用，
 * 调用方只管 pending 态。
 */
export async function dormantSessionWithFeedback(
    deps: DormancyActionDeps,
    sessionId: string,
    onDone: () => void,
): Promise<void> {
    const { api, queryClient, t, modal, message } = deps
    const invalidate = () => invalidateSessionViews(queryClient, [sessionId])
    // 成功仪式两路共用（休眠 / 强制退出 archive）。⚠️ 只包成功后的反馈——不能包住
    // API 调用本身，否则 409 blockers 被这里吞掉，gate 阻塞的强制退出弹窗成死代码
    const reportSuccess = async () => {
        void message.success(t('common.success'))
        await invalidate()
    }
    try {
        await api.sessions.dormant(sessionId)
        await reportSuccess()
    } catch (error) {
        const blockers = extractBlockers(error)
        if (blockers.length === 0) {
            void message.warning(dormancyErrorText(error, t))
            return
        }
        const forceExit = await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: t('session.dormancy.forceExitTitle'),
                content: dormancyBlockedText(blockers, t),
                okText: t('session.dormancy.forceExitOk'),
                okButtonProps: { danger: true },
                cancelText: t('common.cancel'),
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            })
        })
        if (!forceExit) return
        try {
            await api.sessions.archive(sessionId)
            await reportSuccess()
        } catch {
            void message.error(t('common.error'))
        }
    } finally {
        onDone()
    }
}

/**
 * 手动休眠的错误转述（dormancy spec §D.11）：409 携带的逐项 blocker code →
 * i18n 文案；无 blocker 的失败（RPC 断连等）走通用失败文案。休眠入口的
 * 反馈文案单源——不各写一份映射。
 */
export function dormancyErrorText(error: unknown, t: TFunction): string {
    const blockers = extractBlockers(error)
    if (blockers.length > 0) {
        return dormancyBlockedText(blockers, t)
    }
    return t('session.dormancy.failed')
}
