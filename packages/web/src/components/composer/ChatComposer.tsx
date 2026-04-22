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
import { PaperClipOutlined, SettingOutlined, StopOutlined, PlayCircleOutlined, SwapOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { useTranslation } from 'react-i18next'
import type { AgentState, PermissionMode, Session } from '@mobi/shared'
import { getPermissionModeOptionsForFlavor } from '@mobi/shared'
import { StatusBar } from './StatusBar'
import { AttachmentList } from './AttachmentItem'
import { useSessionFileListing } from './useSessionFileListing'
import type { FileListingInput, FileSuggestionItem } from './useSessionFileListing'
import { useSlashCommandSuggestion } from './useSlashCommandSuggestion'
import { detectSlashAtCursor } from '@/domain/command/slashCommandHelper'
import { detectMentionAtCursor, buildMentionPath } from '@/domain/command/mentionParser'
import type { SlashCommandSuggestionItem } from '@/domain/command/slashCommandHelper'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { createFileAttachment } from '@/core/lib/fileAttachments'
import { recordCommandUsage } from '@/core/lib/commandUsage'
import { useCommands } from '@/core/data/hooks/queries/useCommands'
import { MentionDropdown } from './MentionDropdown'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { CommandHintBar } from './CommandHintBar'

interface ChatComposerProps {
    disabled?: boolean
    permissionMode?: PermissionMode
    model?: string | null
    active?: boolean
    allowSendWhenInactive?: boolean
    thinking?: boolean
    agentState?: AgentState | null
    contextSize?: number
    agentFlavor?: string | null
    sessionId?: string
    mode?: Session['mode']
    workingDir?: string
    extraLeftButtons?: React.ReactNode
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string | null) => void
    onSend: (text: string) => void
    onAbort?: () => void
    onActivate?: () => void
    activatePending?: boolean
    onSwitchToRemote?: () => void
    switchPending?: boolean
}

function getTextarea(wrapper: HTMLDivElement | null): HTMLTextAreaElement | null {
    return wrapper?.querySelector('textarea') ?? null
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

    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<FileAttachment[]>([])

    const [activeCommand, setActiveCommand] = useState<{ value: string; hint: string } | null>(null)

    // 命令列表（复用 React Query 缓存，用于手动输入时匹配参数提示）
    const { data: commandsData } = useCommands(sessionId ?? null)

    const [suggestionOpen, setSuggestionOpen] = useState(false)
    const [mentionInput, setMentionInput] = useState<FileListingInput | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const mentionAtIndexRef = useRef(-1)
    const pendingCursorRef = useRef<number | null>(null)

    const scrollIntoActive = useCallback((node: HTMLDivElement | null) => {
        node?.scrollIntoView({ block: 'nearest' })
    }, [])

    const [slashOpen, setSlashOpen] = useState(false)
    const [slashFilter, setSlashFilter] = useState('')
    const [slashActiveIndex, setSlashActiveIndex] = useState(0)

    const { items: slashCommands, isLoading: slashLoading } = useSlashCommandSuggestion(
        slashOpen ? (sessionId ?? null) : null,
        slashOpen,
        slashFilter,
        workingDir,
    )

    const { items: fileEntries, isLoading: fileListLoading } = useSessionFileListing(
        suggestionOpen ? (sessionId ?? null) : null,
        mentionInput,
    )

    const controlsDisabled = disabled || (!active && !allowSendWhenInactive)
    const trimmed = text.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0
    const canSend = (hasText || hasAttachments) && !controlsDisabled && !thinking

    // 是否展示命令参数幽灵提示
    const showGhostHint = !!activeCommand?.hint
        && text === `${activeCommand.value} `
        && !slashOpen

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
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

    // 光标位置恢复
    useEffect(() => {
        if (pendingCursorRef.current != null) {
            const textarea = getTextarea(wrapperRef.current)
            if (textarea) {
                textarea.selectionStart = textarea.selectionEnd = pendingCursorRef.current
                textarea.focus()
            }
            pendingCursorRef.current = null
        }
    })

    const handleChange = useCallback((value: string) => {
        // 中文「！」后紧跟空格自动转英文「!」
        if (value.startsWith('！ ')) {
            const textarea = getTextarea(wrapperRef.current)
            pendingCursorRef.current = textarea?.selectionStart ?? value.length
            value = '! ' + value.slice(2)
        }

        setText(value)

        const textarea = getTextarea(wrapperRef.current)
        const cursorPos = textarea?.selectionStart ?? value.length

        // 检测 slash 命令
        const slashFilter = detectSlashAtCursor(value, cursorPos)
        if (slashFilter !== null) {
            setSlashFilter(slashFilter)
            setSlashOpen(true)
            setSlashActiveIndex(0)
            setSuggestionOpen(false)
            setMentionInput(null)
            return
        }

        if (slashOpen) {
            setSlashOpen(false)
            setSlashFilter('')
        }

        // 文本不再匹配已选命令时，清理提示状态
        if (activeCommand && value !== `${activeCommand.value} `) {
            setActiveCommand(null)
        }

        // 手动输入 /command + 空格后，匹配参数提示
        const cmdMatch = value.match(/^\/(\S+) $/)
        if (cmdMatch && !activeCommand) {
            const cmdName = `/${cmdMatch[1]}`
            const cmd = commandsData?.find(c =>
                (c.name.startsWith('/') ? c.name : `/${c.name}`) === cmdName
            )
            if (cmd?.argumentHint) {
                setActiveCommand({ value: cmdName, hint: cmd.argumentHint })
            }
        }

        // 检测 @ mention
        const mention = detectMentionAtCursor(value, cursorPos)
        if (mention) {
            mentionAtIndexRef.current = mention.atIndex
            setMentionInput({
                mentionInput: mention.afterAt,
                workingDir: workingDir ?? '',
            })
            setSuggestionOpen(true)
            setActiveIndex(0)
            return
        }

        setSuggestionOpen(false)
        setMentionInput(null)
    }, [workingDir, slashOpen, activeCommand, commandsData])

    // @ mention 选择
    const handleItemSelect = useCallback((item: FileSuggestionItem) => {
        if (!mentionInput) return

        const atIndex = mentionAtIndexRef.current
        const afterLen = mentionInput.mentionInput.length
        const before = atIndex >= 0 ? text.slice(0, atIndex) : text
        const after = atIndex >= 0 ? text.slice(atIndex + 1 + afterLen) : ''

        if (item.isDirectory) {
            const dirPath = item.path ? item.path + '/' : buildMentionPath(mentionInput.mentionInput, item.value) + '/'
            setText(`${before}@${dirPath}${after}`)
            mentionAtIndexRef.current = atIndex
            pendingCursorRef.current = atIndex + 1 + dirPath.length
            setMentionInput({
                mentionInput: dirPath,
                workingDir: mentionInput.workingDir,
            })
            setActiveIndex(0)
        } else {
            const mentionPath = item.path ?? buildMentionPath(mentionInput.mentionInput, item.value)
            setText(`${before}@${mentionPath} ${after}`)
            setSuggestionOpen(false)
            setMentionInput(null)
        }
    }, [mentionInput, text])

    // slash command 选择
    const handleSlashSelect = useCallback((item: SlashCommandSuggestionItem) => {
        const slashEnd = 1 + slashFilter.length
        const after = text.slice(slashEnd)
        setText(`${item.value} ${after}`)
        setActiveCommand(item.argumentHint ? { value: item.value, hint: item.argumentHint } : null)
        setSlashOpen(false)
        setSlashFilter('')

        if (workingDir) {
            recordCommandUsage(workingDir, item.value)
        }
    }, [slashFilter, text, workingDir])

    // Tab 键选中 @ mention
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
        setActiveCommand(null)
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

    const showInactiveCover = !active && !allowSendWhenInactive
    const showLocalModeCover = active && mode === 'local'
    const isBashMode = text.startsWith('! ')

    // Sender header 区域内容（可组合，多条可共存）
    const headerNodes = [
        showGhostHint && activeCommand && (
            <CommandHintBar key="hint" hint={activeCommand.hint} />
        ),
        hasAttachments && (
            <AttachmentList
                key="attachments"
                attachments={attachments}
                onRemove={handleRemoveAttachment}
            />
        ),
    ].filter(Boolean)

    return (
        <div style={{ padding: '0 12px 12px' }}>
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

            <div ref={wrapperRef} className={isBashMode ? 'bash-mode' : undefined} style={{ position: 'relative' }}>
                <Sender
                    value={text}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    onCancel={onAbort}
                    placeholder={isBashMode ? t('composer.bashPlaceholder') : t('composer.placeholder')}
                    disabled={controlsDisabled || showInactiveCover || showLocalModeCover}
                    loading={thinking}
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    onKeyDown={handleKeyDown}
                    header={headerNodes.length > 0 ? headerNodes : null}
                    suffix={false}
                    footer={(oriNode) => (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Space size={4}>
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

                                {extraLeftButtons}
                            </Space>

                            {showLocalModeCover ? null : oriNode}
                        </div>
                    )}
                />

                {/* @ 文件引用下拉 */}
                {suggestionOpen && (
                    <MentionDropdown
                        items={fileEntries}
                        loading={fileListLoading}
                        activeIndex={activeIndex}
                        scrollIntoActive={scrollIntoActive}
                        onSelect={handleItemSelect}
                        onHover={setActiveIndex}
                    />
                )}

                {/* slash command 下拉 */}
                {slashOpen && (
                    <SlashCommandDropdown
                        items={slashCommands}
                        loading={slashLoading}
                        activeIndex={slashActiveIndex}
                        scrollIntoActive={scrollIntoActive}
                        onSelect={handleSlashSelect}
                        onHover={setSlashActiveIndex}
                    />
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

                {/* 本地模式覆盖层 */}
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
