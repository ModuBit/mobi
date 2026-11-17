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

import { useCallback, useState, type ReactNode } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { Button } from '@/ui/base/interactive/button/Button'
import { AdaptiveDialog } from '@/ui/base/interactive/adaptiveDialog/AdaptiveDialog'
import { notifyRetainedWorktree, notifyTranscriptRetained } from './retainedWorktreeNotice'
import { evictSession } from '@/core/lib/sessionEviction'
import { deleteBlockedText } from '@/core/data/sessionDormancy'
import type { Session } from '@/core/data/api/types'

/**
 * 删除会话动作流（桌面侧栏 / 归档页共用；移动端 ActionSheet 因「就地确认」形态不同，
 * 不走此 hook）。确认 → 删除 → 结果告知（保留 worktree / transcript 未删）→
 * 缓存清理 → 当前会话被删时导航离开。
 *
 * 返回 `{ confirmDelete, confirmNode }`：确认框走自管自适应壳（PC 居中 Dialog /
 * 移动端底部 sheet），`confirmNode` 由调用方渲染；删除中锁住关闭，结果反馈仍走
 * App 上下文的 message / notification。
 */
export function useSessionDelete(): { confirmDelete: (session: Session) => void; confirmNode: ReactNode } {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { message: messageApi, notification } = App.useApp()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    const [target, setTarget] = useState<Session | null>(null)
    const [deleting, setDeleting] = useState(false)

    const confirmDelete = useCallback((session: Session) => setTarget(session), [])

    const handleConfirm = useCallback(async () => {
        if (!target) return
        setDeleting(true)
        try {
            const deleted = await api.sessions.delete(target.id)
            if (deleted.data.retainedWorktree) {
                notifyRetainedWorktree({
                    notification,
                    t,
                    retained: deleted.data.retainedWorktree,
                    onManage: () => { void navigate({ to: '/settings/worktrees' }) }
                })
            }
            if (deleted.data.transcriptDeleted === false) {
                // transcript 诚实告知（票 07）：删了 mobi 记录但 CC 对话记录还在，说明原因。
                // 与 worktree 保留独立告知——两者可同现（fork 行脏 worktree + 未绑 native id），
                // 互斥链会吞掉一边
                notifyTranscriptRetained({
                    notification,
                    t,
                    reason: deleted.data.transcriptRetainedReason ?? '',
                })
            } else if (!deleted.data.retainedWorktree) {
                messageApi.success(t('common.success'))
            }
            await evictSession(queryClient, [target.id])
            if (activeSessionId === target.id) {
                navigate({ to: '/sessions' })
            }
        } catch (error) {
            // gate 阻塞（daemon 删除前自动休眠被挡）→ 逐项原因文案；其余通用错误
            messageApi.error(deleteBlockedText(error, t) ?? t('common.error'))
        } finally {
            setDeleting(false)
            setTarget(null)
        }
    }, [api, t, queryClient, activeSessionId, navigate, messageApi, notification, target])

    const confirmNode = (
        <AdaptiveDialog
            open={target !== null}
            onOpenChange={(next) => { if (!next && !deleting) setTarget(null) }}
            title={t('session.actions.deleteConfirmTitle')}
            width={440}
            body={<p style={{ margin: 0 }}>{t('session.actions.deleteConfirmContent')}</p>}
            footer={(
                <>
                    <Button variant="secondary" disabled={deleting} onClick={() => setTarget(null)}>
                        {t('common.cancel')}
                    </Button>
                    <Button variant="danger" loading={deleting} onClick={() => { void handleConfirm() }}>
                        {t('common.confirm')}
                    </Button>
                </>
            )}
        />
    )

    return { confirmDelete, confirmNode }
}
