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
import { normalizeUserContent, type UserContentBlock } from '@mobi/shared'
import { isQueuedInMobi } from '@/core/lib/messages'
import { useCancelQueuedMessage } from '@/core/data/hooks/mutations/useCancelQueuedMessage'
import { useSteerQueuedMessage } from '@/core/data/hooks/mutations/useSteerQueuedMessage'
import { summarizeBlocks } from '@/domain/chat/userContentSummary'
import { deserializeSegments, emptySegments, type ComposerSegments } from '@/domain/chat/composerSegments'
import type { DecryptedMessage } from '@/core/data/api/types'

/**
 * 从消息信封（wire 格式）提取用户输入 blocks。
 * 信封内层 content 兼容旧平铺 / 新 block 数组（normalizeUserContent 四形态归一）；
 * 非 user 信封（agent/系统）不该出现在此（调用方已滤 queued），防御返回 null。
 */
function userBlocksOf(msg: DecryptedMessage): UserContentBlock[] | null {
    const envelope = msg.content as { role?: string; content?: unknown } | null
    if (envelope?.role !== 'user') return null
    return normalizeUserContent(envelope.content)
}

export interface QueuedMessagesBarProps {
    sessionId: string
    messages: DecryptedMessage[]
    /** 编辑：取消该消息 + 把完整分段（text + 附件双桶 + 引用）回填 composer */
    onEdit: (segments: ComposerSegments) => void
}

/**
 * 排队消息悬浮条
 * agent 运行中时新发的消息进入排队，在此展示，支持插队/取消/编辑。
 * cancelled/discarded 终态消息不在此展示——终态可见性由聊天流内的灰色标注承担
 *（ChatContainer footer 标注），composer 区不再呈现终态列表。
 */
export function QueuedMessagesBar(props: QueuedMessagesBarProps): React.ReactElement | null {
    const { sessionId, messages, onEdit } = props
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [messageApi, contextHolder] = message.useMessage()
    const cancelMutation = useCancelQueuedMessage(sessionId)
    const steerMutation = useSteerQueuedMessage(sessionId)

    // 单行预览：text 原文连接 + 非 text block 标签占位（summarizeBlocks 单源）；normalize 失败回落 originalText
    const summaryLabels = useMemo(() => ({
        file: t('chat.summary.file'),
        image: t('chat.summary.image'),
        quote: t('chat.summary.quote'),
    }), [t])
    const previewOf = (msg: DecryptedMessage): string =>
        summarizeBlocks(userBlocksOf(msg) ?? [], summaryLabels) || msg.originalText || ''

    // 防御性二次过滤 + 按时间排序。
    // 调用方（QueuedMessagesSection）的 useMessages select 已滤出排队子集（性能优化：避免传全量数组），
    // 这里再过一遍是组件自洽的**正确性边界**——Bar 自身契约「只展示排队消息」，不依赖调用方契约，
    // 即便未来有别的调用方传混杂数组也不会误展示已提交消息。两者意图不同，非冗余。
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
                    // 结构化还原：normalize 归一后 deserialize 为分段（text + 附件双桶 + 引用）；
                    // normalize 失败（快照/乐观形态）兜底 originalText 纯文本。
                    // 剔除指向被取消消息自身的 quote（防御：引用不可能合法指向排队中的本条，
                    // 残留只会产生 dangling 引用块）
                    const blocks = userBlocksOf(msg)
                        ?.filter(b => b.type !== 'quote' || b.messageId !== msg.id)
                    if (blocks) {
                        onEdit(deserializeSegments(blocks))
                    } else {
                        onEdit({ ...emptySegments(), text: msg.originalText ?? '' })
                    }
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
                {/* 排队分区（有排队消息时才展示标题行与列表） */}
                {queued.length > 0 && (
                    <>
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
                                text={previewOf(msg)}
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
                    </>
                )}
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
