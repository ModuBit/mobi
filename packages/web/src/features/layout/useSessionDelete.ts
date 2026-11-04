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

import { useCallback } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { notifyRetainedWorktree, notifyTranscriptRetained } from './retainedWorktreeNotice'
import { evictSession } from '@/core/lib/sessionEviction'
import { deleteBlockedText } from '@/core/data/sessionDormancy'
import type { Session } from '@/core/data/api/types'

/**
 * 删除会话动作流（桌面侧栏 / 归档页共用；移动端 ActionSheet 因「就地确认」形态不同，
 * 不走此 hook）。确认 → 删除 → 结果告知（保留 worktree / transcript 未删）→
 * 缓存清理 → 当前会话被删时导航离开。弹层/反馈上下文由 hook 自取，调用点一行触发。
 */
export function useSessionDelete() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { message: messageApi, modal, notification } = App.useApp()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    return useCallback((session: Session) => {
        modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    const deleted = await api.sessions.delete(session.id)
                    if (deleted.data.retainedWorktree) {
                        notifyRetainedWorktree({
                            notification,
                            t,
                            retained: deleted.data.retainedWorktree,
                            onManage: () => { void navigate({ to: '/settings/worktrees' }) }
                        })
                    } else if (deleted.data.transcriptDeleted === false) {
                        // transcript 诚实告知（票 07）：删了 mobi 记录但 CC 对话记录还在，说明原因
                        notifyTranscriptRetained({
                            notification,
                            t,
                            reason: deleted.data.transcriptRetainedReason ?? '',
                        })
                    } else {
                        messageApi.success(t('common.success'))
                    }
                    await evictSession(queryClient, [session.id])
                    if (activeSessionId === session.id) {
                        navigate({ to: '/sessions' })
                    }
                } catch (error) {
                    // gate 阻塞（daemon 删除前自动休眠被挡）→ 逐项原因文案；其余通用错误
                    messageApi.error(deleteBlockedText(error, t) ?? t('common.error'))
                }
            },
        })
    }, [api, t, queryClient, activeSessionId, navigate, messageApi, notification, modal])
}
