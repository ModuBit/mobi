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

import { useMemo } from 'react'
import { Button, theme, message } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { ClockCircleOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { isQueuedInMobi } from '@/core/lib/messages'
import { useCancelQueuedMessage } from '@/core/data/hooks/mutations/useCancelQueuedMessage'
import { useSteerQueuedMessage } from '@/core/data/hooks/mutations/useSteerQueuedMessage'
import type { DecryptedMessage } from '@/core/data/api/types'

/**
 * 从消息中提取纯文本预览
 * 乐观消息格式：content.content.text
 * 后备：originalText
 */
export function previewText(msg: DecryptedMessage): string {
    const c = msg.content as { content?: { text?: string } } | null
    return c?.content?.text ?? msg.originalText ?? ''
}

export interface QueuedMessagesBarProps {
    sessionId: string
    messages: DecryptedMessage[]
    /** 编辑：取消该消息 + 把文本回填 composer */
    onEdit: (text: string) => void
}

/**
 * 排队消息悬浮条
 * agent 运行中时新发的消息进入排队，在此展示，支持取消/编辑
 */
export function QueuedMessagesBar(props: QueuedMessagesBarProps): React.ReactElement | null {
    const { sessionId, messages, onEdit } = props
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [messageApi, contextHolder] = message.useMessage()
    const cancelMutation = useCancelQueuedMessage(sessionId)
    const steerMutation = useSteerQueuedMessage(sessionId)

    const queued = useMemo(
        () => messages
            .filter(isQueuedInMobi)
            .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
        [messages],
    )

    if (queued.length === 0) return null

    const handleCancel = (msg: DecryptedMessage) => {
        if (!msg.localId) return
        cancelMutation.mutate(msg.localId)
    }

    const handleEdit = (msg: DecryptedMessage) => {
        if (!msg.localId) return
        cancelMutation.mutate(msg.localId, {
            onSuccess: (res) => {
                // 只有真正取消成功才回填；已被 agent 处理则提示
                if (res.data.status === 'cancelled') {
                    onEdit(previewText(msg))
                } else {
                    messageApi.info(t('chat.queued.alreadySubmitted'))
                }
            },
        })
    }

    const handleSteer = (msg: DecryptedMessage) => {
        if (!msg.localId) return
        steerMutation.mutate(msg.localId, {
            onError: () => messageApi.info(t('chat.queued.steerFailed')),
        })
    }

    return (
        <div style={{ padding: '0 12px' }}>
            {contextHolder}
            <div style={{
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadiusLG,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: token.paddingXS,
            }}>
                {/* 标题行 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: token.colorTextSecondary,
                    fontSize: 12,
                }}>
                    <ClockCircleOutlined style={{ fontSize: 13, color: token.colorInfo }} />
                    <span>{t('chat.queued.title', { count: queued.length })}</span>
                </div>

                {/* 排队消息列表 */}
                {queued.map(msg => (
                    <QueuedItem
                        key={msg.localId ?? msg.id}
                        text={previewText(msg)}
                        cancelPending={
                            cancelMutation.isPending &&
                            cancelMutation.variables === msg.localId
                        }
                        steerPending={
                            steerMutation.isPending &&
                            steerMutation.variables === msg.localId
                        }
                        onEdit={() => handleEdit(msg)}
                        onCancel={() => handleCancel(msg)}
                        onSteer={() => handleSteer(msg)}
                        editLabel={t('chat.queued.edit')}
                        cancelLabel={t('chat.queued.cancel')}
                        steerLabel={t('chat.queued.steer')}
                    />
                ))}
            </div>
        </div>
    )
}

/** 单条排队消息卡片 */
function QueuedItem(props: {
    text: string
    cancelPending: boolean
    steerPending: boolean
    onEdit: () => void
    onCancel: () => void
    onSteer: () => void
    editLabel: string
    cancelLabel: string
    steerLabel: string
}): React.ReactElement {
    const { text, cancelPending, steerPending, onEdit, onCancel, onSteer, editLabel, cancelLabel, steerLabel } = props
    const { token } = theme.useToken()

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.paddingXS,
                background: token.colorBgContainer,
                borderRadius: token.borderRadius,
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                minHeight: 36,
            }}
        >
            {/* 文本预览：最多 3 行截断 */}
            <span
                style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: token.colorText,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                }}
            >
                {text || '...'}
            </span>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <AppTooltip title={steerLabel}>
                    <Button
                        type="text"
                        size="small"
                        icon={<ThunderboltOutlined />}
                        onClick={onSteer}
                        loading={steerPending}
                        disabled={cancelPending}
                    />
                </AppTooltip>
                <AppTooltip title={editLabel}>
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={onEdit}
                        disabled={cancelPending || steerPending}
                    />
                </AppTooltip>
                <AppTooltip title={cancelLabel}>
                    <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={onCancel}
                        loading={cancelPending}
                        disabled={steerPending}
                    />
                </AppTooltip>
            </div>
        </div>
    )
}
