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

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Button, Tooltip, Space } from 'antd'
import { PaperClipOutlined, SettingOutlined, StopOutlined, PlayCircleOutlined, SwapOutlined, FolderOutlined, FileOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { useTranslation } from 'react-i18next'
import type { AgentState, PermissionMode, Session } from '@mobi/shared'
import {
    getPermissionModeOptionsForFlavor
} from '@mobi/shared'
import { StatusBar } from './StatusBar'
import { AttachmentList } from './AttachmentItem'
import { useSessionFileListing } from './useSessionFileListing'
import type { FileListingInput, FileSuggestionItem } from './useSessionFileListing'
import { useSlashCommandSuggestion } from './useSlashCommandSuggestion'
import { isSlashTrigger } from './slashCommandHelper'
import type { SlashCommandSuggestionItem } from './slashCommandHelper'
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
    /** 会话运行模式 */
    mode?: Session['mode']
    /** 会话工作目录 */
    workingDir?: string
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
    /** 激活会话回调 */
    onActivate?: () => void
    /** 激活会话是否进行中 */
    activatePending?: boolean
    /** 切换到远程模式回调 */
    onSwitchToRemote?: () => void
    /** 切换模式是否进行中 */
    switchPending?: boolean
}

/**
 * 拼接 @ 引用路径（保留用户输入的相对形式）
 */
function buildMentionPath(mentionInput: string, selectedName: string): string {
    const lastSlash = mentionInput.lastIndexOf('/')
    const dirPart = lastSlash !== -1 ? mentionInput.slice(0, lastSlash + 1) : ''
    return dirPart + selectedName
}

/**
 * 聊天输入组件
 * 基于 antd X 的 Sender 组件，支持多行输入、附件上传、@文件引用
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
        mode,
        workingDir,
        extraLeftButtons,
        onPermissionModeChange,
        onSend,
        onAbort,
        onActivate,
        activatePending = false,
        onSwitchToRemote,
        switchPending = false,
    } = props

    // 输入状态
    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<FileAttachment[]>([])

    // @ 文件引用状态
    const [suggestionOpen, setSuggestionOpen] = useState(false)
    const [mentionInput, setMentionInput] = useState<FileListingInput | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const wrapperRef = useRef<HTMLDivElement>(null)

    // slash command 状态
    const [slashOpen, setSlashOpen] = useState(false)
    const [slashFilter, setSlashFilter] = useState('')
    const [slashActiveIndex, setSlashActiveIndex] = useState(0)

    const { items: slashCommands, isLoading: slashLoading } = useSlashCommandSuggestion(
        slashOpen ? (sessionId ?? null) : null,
        slashOpen,
        slashFilter,
    )

    const { items: fileEntries, isLoading: fileListLoading } = useSessionFileListing(
        suggestionOpen ? (sessionId ?? null) : null,
        mentionInput,
    )

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

    // 点击外部关闭下拉
    useEffect(() => {
        if (!suggestionOpen && !slashOpen) return
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setSuggestionOpen(false)
                setMentionInput(null)
                setSlashOpen(false)
                setSlashFilter('')
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [suggestionOpen, slashOpen])

    const handleChange = useCallback((value: string) => {
        setText(value)

        // 检测 / 触发（行首）
        if (isSlashTrigger(value)) {
            const filter = value.slice(1) // 去掉 / 前缀
            setSlashFilter(filter)
            setSlashOpen(true)
            setSlashActiveIndex(0)
            // 关闭 @mention 下拉（互斥）
            setSuggestionOpen(false)
            setMentionInput(null)
            return
        }

        // 关闭 slash 下拉
        if (slashOpen) {
            setSlashOpen(false)
            setSlashFilter('')
        }

        // 检测 @ 触发
        const atIdx = value.lastIndexOf('@')
        if (atIdx !== -1) {
            const afterAt = value.slice(atIdx + 1)
            // @ 后面只包含路径字符时才触发
            if (/^[a-zA-Z0-9.\/_\-]*$/.test(afterAt)) {
                setMentionInput({
                    mentionInput: afterAt,
                    workingDir: workingDir ?? '',
                })
                setSuggestionOpen(true)
                setActiveIndex(0)
                return
            }
        }

        setSuggestionOpen(false)
        setMentionInput(null)
    }, [workingDir, slashOpen])

    const handleItemSelect = useCallback((item: FileSuggestionItem) => {
        if (!mentionInput) return

        if (item.isDirectory) {
            // 目录：更新前缀继续浏览
            const currentAfterAt = mentionInput.mentionInput
            const lastSlash = currentAfterAt.lastIndexOf('/')
            const dirPart = lastSlash !== -1 ? currentAfterAt.slice(0, lastSlash + 1) : ''
            const newInput = dirPart + item.value + '/'

            const atIdx = text.lastIndexOf('@')
            if (atIdx !== -1) {
                setText(text.slice(0, atIdx + 1) + newInput)
            }
            setMentionInput({
                mentionInput: newInput,
                workingDir: mentionInput.workingDir,
            })
            setActiveIndex(0)
        } else {
            // 文件：用纯文本替换 @xxx，关闭下拉
            const mentionPath = buildMentionPath(mentionInput.mentionInput, item.value)

            const atIdx = text.lastIndexOf('@')
            const beforeAt = atIdx !== -1 ? text.slice(0, atIdx) : text
            setText(`${beforeAt}@${mentionPath} `)

            setSuggestionOpen(false)
            setMentionInput(null)
        }
    }, [mentionInput, text])

    const handleSlashSelect = useCallback((item: SlashCommandSuggestionItem) => {
        setText(`${item.value} `)
        setSlashOpen(false)
        setSlashFilter('')
    }, [])

    // 原生捕获阶段拦截 Tab，避免 Sender 内部先消费导致焦点跳走
    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper || !suggestionOpen) return

        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return
            if (fileEntries.length === 0) return
            e.preventDefault()
            e.stopPropagation()
            handleItemSelect(fileEntries[activeIndex])
        }

        wrapper.addEventListener('keydown', handler, true)
        return () => wrapper.removeEventListener('keydown', handler, true)
    }, [suggestionOpen, fileEntries, activeIndex, handleItemSelect])

    // Tab 键选中 slash command
    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper || !slashOpen) return

        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return
            if (slashCommands.length === 0) return
            e.preventDefault()
            e.stopPropagation()
            handleSlashSelect(slashCommands[slashActiveIndex])
        }

        wrapper.addEventListener('keydown', handler, true)
        return () => wrapper.removeEventListener('keydown', handler, true)
    }, [slashOpen, slashCommands, slashActiveIndex, handleSlashSelect])

    // 键盘导航
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // slash command 下拉导航
        if (slashOpen && slashCommands.length > 0) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    setSlashActiveIndex(prev => (prev + 1) % slashCommands.length)
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    setSlashActiveIndex(prev => (prev - 1 + slashCommands.length) % slashCommands.length)
                    break
                case 'Enter':
                    e.preventDefault()
                    e.stopPropagation()
                    handleSlashSelect(slashCommands[slashActiveIndex])
                    break
                case 'Escape':
                    e.preventDefault()
                    setSlashOpen(false)
                    setSlashFilter('')
                    break
            }
            return
        }

        // @mention 下拉导航
        if (!suggestionOpen || fileEntries.length === 0) return

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setActiveIndex(prev => (prev + 1) % fileEntries.length)
                break
            case 'ArrowUp':
                e.preventDefault()
                setActiveIndex(prev => (prev - 1 + fileEntries.length) % fileEntries.length)
                break
            case 'Enter':
                e.preventDefault()
                e.stopPropagation()
                handleItemSelect(fileEntries[activeIndex])
                break
            case 'Escape':
                e.preventDefault()
                setSuggestionOpen(false)
                setMentionInput(null)
                break
        }
    }, [slashOpen, slashCommands, slashActiveIndex, handleSlashSelect, suggestionOpen, fileEntries, activeIndex, handleItemSelect])

    const handleSubmit = useCallback((content: string) => {
        if (!canSend) return
        if (suggestionOpen || slashOpen) return
        onSend(content.trim())
        setText('')
        setAttachments([])
    }, [canSend, onSend, suggestionOpen, slashOpen])

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

    // 会话未激活时的覆盖层
    const showInactiveCover = !active && !allowSendWhenInactive

    // 本地模式时的覆盖层（保留 footer 中的 file/terminal 按钮）
    const showLocalModeCover = active && mode === 'local'

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
            <div ref={wrapperRef} style={{ position: 'relative' }}>
                <Sender
                    value={text}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    onCancel={onAbort}
                    placeholder={t('composer.placeholder')}
                    disabled={controlsDisabled || showInactiveCover || showLocalModeCover}
                    loading={thinking}
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    onKeyDown={handleKeyDown}
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
                                        disabled={controlsDisabled || showLocalModeCover}
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
                                            disabled={controlsDisabled || showLocalModeCover}
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
                            {showLocalModeCover ? null : oriNode}
                        </div>
                    )}
                />

                {/* @ 文件引用下拉列表 */}
                {suggestionOpen && (fileEntries.length > 0 || fileListLoading) && (
                    <div
                        role="listbox"
                        style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 0,
                            right: 0,
                            maxHeight: 240,
                            overflowY: 'auto',
                            backgroundColor: 'var(--ant-color-bg-elevated)',
                            borderRadius: 'var(--ant-border-radius)',
                            boxShadow: 'var(--ant-box-shadow-secondary)',
                            zIndex: 50,
                            marginBottom: 4,
                        }}
                    >
                        {fileListLoading && fileEntries.length === 0 ? (
                            <div style={{ padding: '8px 12px', color: 'var(--ant-color-text-tertiary)', fontSize: 14 }}>
                                {t('common.loading')}
                            </div>
                        ) : fileEntries.map((item, index) => (
                            <div
                                key={item.value}
                                role="option"
                                aria-selected={index === activeIndex}
                                onClick={() => handleItemSelect(item)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    backgroundColor: index === activeIndex
                                        ? 'var(--ant-color-bg-text-hover)'
                                        : 'transparent',
                                    fontSize: 14,
                                }}
                                onMouseEnter={() => setActiveIndex(index)}
                            >
                                {item.isDirectory
                                    ? <FolderOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
                                    : <FileOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
                                <span>{item.label}</span>
                                {item.isDirectory && (
                                    <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>/</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* slash command 下拉列表 */}
                {slashOpen && (slashCommands.length > 0 || slashLoading) && (
                    <div
                        role="listbox"
                        style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 0,
                            right: 0,
                            maxHeight: 240,
                            overflowY: 'auto',
                            backgroundColor: 'var(--ant-color-bg-elevated)',
                            borderRadius: 'var(--ant-border-radius)',
                            boxShadow: 'var(--ant-box-shadow-secondary)',
                            zIndex: 50,
                            marginBottom: 4,
                        }}
                    >
                        {slashLoading && slashCommands.length === 0 ? (
                            <div style={{ padding: '8px 12px', color: 'var(--ant-color-text-tertiary)', fontSize: 14 }}>
                                {t('common.loading')}
                            </div>
                        ) : slashCommands.map((item, index) => (
                            <div
                                key={item.value}
                                role="option"
                                aria-selected={index === slashActiveIndex}
                                onClick={() => handleSlashSelect(item)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '6px 12px',
                                    cursor: 'pointer',
                                    backgroundColor: index === slashActiveIndex
                                        ? 'var(--ant-color-bg-text-hover)'
                                        : 'transparent',
                                    fontSize: 14,
                                }}
                                onMouseEnter={() => setSlashActiveIndex(index)}
                            >
                                <span style={{ fontWeight: 500 }}>{item.label}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {item.description && (
                                        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
                                            {item.description}
                                        </span>
                                    )}
                                    {item.source && (
                                        <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 11 }}>
                                            {item.source}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 未激活覆盖层 */}
                {showInactiveCover && (
                    <div
                        className="sender-overlay"
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'var(--ant-border-radius)',
                            zIndex: 10,
                        }}
                    >
                        <Button
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            loading={activatePending}
                            onClick={onActivate}
                        >
                            {t('composer.activate')}
                        </Button>
                    </div>
                )}

                {/* 本地模式覆盖层（保留 footer 中的按钮） */}
                {showLocalModeCover && (
                    <div
                        className="sender-overlay"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 56,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'var(--ant-border-radius)',
                            zIndex: 10,
                        }}
                    >
                        <Button
                            type="primary"
                            icon={<SwapOutlined />}
                            loading={switchPending}
                            onClick={onSwitchToRemote}
                        >
                            {t('composer.switchToRemote')}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
