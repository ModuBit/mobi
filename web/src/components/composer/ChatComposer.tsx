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

import { useState, useCallback, useMemo } from 'react'
import { Button, Tooltip, Space } from 'antd'
import { PaperClipOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { useTranslation } from 'react-i18next'
import type { AgentState, PermissionMode } from '@mobi/shared'
import {
    getPermissionModeOptionsForFlavor
} from '@mobi/shared'
import { StatusBar } from './StatusBar'
import { AttachmentList } from './AttachmentItem'
import type { FileAttachment } from '@/lib/fileAttachments'
import { createFileAttachment } from '@/lib/fileAttachments'

interface ChatComposerProps {
    /** 是否禁用 */
    disabled?: boolean
    /** 权限模式 */
    permissionMode?: PermissionMode
    /** 当前模型 */
    model?: string | null
    /** 会话是否活跃 */
    active?: boolean
    /** 允许非活跃时发送 */
    allowSendWhenInactive?: boolean
    /** 是否正在思考 */
    thinking?: boolean
    /** Agent 状态 */
    agentState?: AgentState | null
    /** 上下文大小 */
    contextSize?: number
    /** Agent 类型 */
    agentFlavor?: string | null
    /** 会话 ID */
    sessionId?: string
    /** 额外的底部按钮（渲染在 Sender footer 区域） */
    extraLeftButtons?: React.ReactNode
    /** 权限模式变更回调 */
    onPermissionModeChange?: (mode: PermissionMode) => void
    /** 模型变更回调 */
    onModelChange?: (model: string | null) => void
    /** 发送消息回调 */
    onSend: (text: string) => void
    /** 中断回调 */
    onAbort?: () => void
}

/**
 * 聊天输入组件
 * 基于 antd X 的 Sender 组件，支持多行输入、附件上传
 */
export function ChatComposer(props: ChatComposerProps) {
    const { t } = useTranslation()

    const {
        disabled = false,
        permissionMode = 'default',
        model = null,
        active = true,
        allowSendWhenInactive = false,
        thinking = false,
        agentState,
        contextSize,
        agentFlavor,
        sessionId,
        extraLeftButtons,
        onPermissionModeChange,
        onSend,
        onAbort
    } = props

    // 输入状态
    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<FileAttachment[]>([])

    // 计算是否禁用控制
    const controlsDisabled = disabled || (!active && !allowSendWhenInactive)
    const trimmed = text.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0

    // 是否可以发送
    const canSend = (hasText || hasAttachments) && !controlsDisabled && !thinking

    // 权限模式选项
    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )

    // 显示设置按钮
    const showSettingsButton = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)

    const handleSubmit = useCallback((content: string) => {
        if (!canSend) return
        onSend(content.trim())
        setText('')
        setAttachments([])
    }, [canSend, onSend])

    const handleAttach = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files
            if (!files) return

            for (const file of Array.from(files)) {
                const attachment = createFileAttachment(file)
                setAttachments(prev => [...prev, attachment])
            }
        }
        input.click()
    }, [])

    const handleRemoveAttachment = useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id))
    }, [])

    return (
        <div style={{ padding: '0 12px 12px' }}>
            {/* 状态栏 */}
            <StatusBar
                sessionId={sessionId ?? ''}
                active={active}
                thinking={thinking}
                agentState={agentState}
                contextSize={contextSize}
                model={model}
                permissionMode={permissionMode}
                agentFlavor={agentFlavor}
            />

            {/* Sender 输入组件 */}
            <Sender
                value={text}
                onChange={setText}
                onSubmit={handleSubmit}
                onCancel={onAbort}
                placeholder={t('composer.placeholder')}
                disabled={controlsDisabled}
                loading={thinking}
                autoSize={{ minRows: 1, maxRows: 5 }}
                header={
                    hasAttachments ? (
                        <AttachmentList
                            attachments={attachments}
                            onRemove={handleRemoveAttachment}
                        />
                    ) : null
                }
                suffix={false}
                footer={(oriNode) => (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={4}>
                            {/* 附件按钮 */}
                            <Tooltip title={t('composer.attach')}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<PaperClipOutlined />}
                                    onClick={handleAttach}
                                    disabled={controlsDisabled}
                                    style={{ borderRadius: '50%' }}
                                />
                            </Tooltip>

                            {/* 设置按钮 */}
                            {showSettingsButton && (
                                <Tooltip title={t('composer.settings')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<SettingOutlined />}
                                        disabled={controlsDisabled}
                                        style={{ borderRadius: '50%' }}
                                    />
                                </Tooltip>
                            )}

                            {/* 中断按钮 */}
                            {thinking && (
                                <Tooltip title={t('composer.abort')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<StopOutlined />}
                                        onClick={onAbort}
                                        style={{ borderRadius: '50%', color: 'var(--ant-color-error)' }}
                                    />
                                </Tooltip>
                            )}

                            {/* 额外按钮（视图切换等） */}
                            {extraLeftButtons}
                        </Space>

                        {/* 发送按钮 */}
                        {oriNode}
                    </div>
                )}
            />
        </div>
    )
}
