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
import { Button, Tooltip, Select, theme, Typography } from 'antd'
import { PaperClipOutlined, PlayCircleOutlined, SwapOutlined, LogoutOutlined, RobotOutlined, SafetyOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { AgentState, EffortLevel, PermissionMode, Session } from '@mobi/shared'
import { getPermissionModeOptionsForFlavor, getPermissionModeTone, getEffortOptions } from '@mobi/shared'
import { CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import { StatusBar } from './StatusBar'
import { AttachmentList } from './AttachmentItem'
import { useSessionFileListing } from './useSessionFileListing'
import { ComposerInfoPanel } from './ComposerInfoPanel'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { FileListingInput, FileSuggestionItem } from './useSessionFileListing'
import { useSlashCommandSuggestion } from './useSlashCommandSuggestion'
import { detectSlashAtCursor } from '@/domain/command/slashCommandHelper'
import { detectMentionAtCursor, buildMentionPath } from '@/domain/command/mentionParser'
import type { SlashCommandSuggestionItem } from '@/domain/command/slashCommandHelper'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { createFileAttachment } from '@/core/lib/fileAttachments'
import { recordCommandUsage } from '@/core/lib/commandUsage'
import { useCommands } from '@/core/data/hooks/queries/useCommands'
import { useSDKMetadata, type ModelOption } from '@/core/data/hooks/queries/useSDKMetadata'
import { MentionDropdown } from './MentionDropdown'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { CommandHintBar } from './CommandHintBar'
import { ResponsiveActionBar, type ActionItem } from './ResponsiveActionBar'
import { getPermissionModeColor } from './permissionModeColors'


interface ChatComposerProps {
    sessionId: string
    disabled?: boolean
    sending?: boolean
    permissionMode?: PermissionMode
    model?: string | null
    active?: boolean
    allowSendWhenInactive?: boolean
    running?: boolean
    agentState?: AgentState | null
    metadata?: SessionMetadataSummary | null
    contextSize?: number
    agentFlavor?: string | null
    mode?: Session['mode']
    workingDir?: string
    extraLeftButtons?: React.ReactNode
    extraItems?: ActionItem[]
    effort?: EffortLevel
    onEffortChange?: (effort: EffortLevel) => void
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string | null) => void
    onSend: (text: string) => void
    onAbort?: () => void
    abortPending?: boolean
    onArchive?: () => void
    archivePending?: boolean
    onActivate?: () => void
    activatePending?: boolean
    onSwitchToRemote?: () => void
    switchPending?: boolean
}

function getTextarea(wrapper: HTMLDivElement | null): HTMLTextAreaElement | null {
    return wrapper?.querySelector('textarea') ?? null
}

// 带有 hover 背景的 borderless Select，与 Button type="text" 的 hover 效果保持一致
const HoverSelect = styled(Select)<{
    $token: ReturnType<typeof theme.useToken>['token']
    $compact?: boolean
}>`
    &.ant-select-borderless:not(.ant-select-disabled):hover {
        background: ${props => props.$token.colorBgTextHover};
    }
    [data-in-dropdown] &.ant-select-borderless:not(.ant-select-disabled):hover {
        background: transparent;
    }
    border-radius: ${props => props.$token.borderRadiusSM}px;
    transition: background 0.2s;
    ${props => props.$compact && `
        &&& .ant-select-selector,
        &&& .ant-select-selector .ant-select-selection-item,
        &&& .ant-select-selector .ant-select-selection-placeholder,
        &&& .ant-select-selector .ant-select-selection-search-input {
            font-size: 12px !important;
            line-height: 18px !important;
            padding-inline-start: 2px !important;
            padding-inline-end: 2px !important;
        }
    `}
`

// 缩小 dropdown 弹出层的 option 字体
const COMPACT_DROPDOWN_CLASS = 'compact-select-dropdown'
const COMPACT_DROPDOWN_STYLE = (
    <style>{`.${COMPACT_DROPDOWN_CLASS} .ant-select-item-option { font-size: 12px !important; padding: 4px 8px !important; min-height: auto !important; }`}</style>
)

// 预配置的紧凑 Select，复用共享样式属性
function CompactHoverSelect(props: Omit<React.ComponentProps<typeof HoverSelect>, 'size' | 'variant' | 'popupMatchSelectWidth' | '$compact'>) {
    return (
        <HoverSelect
            {...props}
            $compact
            size="small"
            variant="borderless"
            popupMatchSelectWidth={false}
            popupClassName={COMPACT_DROPDOWN_CLASS}
        />
    )
}

/**
 * 聊天输入组件
 * 基于 antd X 的 Sender 组件，支持多行输入、附件上传、@文件引用
 */
export function ChatComposer(props: ChatComposerProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const authToken = useAuthStore((state) => state.token)
    const api = useMobiApi(authToken)

    const {
        sessionId,
        disabled = false,
        sending = false,
        permissionMode = 'default',
        model = null,
        active = true,
        allowSendWhenInactive = false,
        running = false,
        agentState,
        metadata,
        contextSize,
        agentFlavor,
        mode,
        workingDir,
        effort = 'medium',
        onEffortChange,
        extraLeftButtons,
        extraItems,
        onPermissionModeChange,
        onModelChange,
        onSend,
        onAbort,
        abortPending = false,
        onArchive,
        archivePending = false,
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

    // SDK 元数据（模型列表等）
    const { data: sdkMetadata } = useSDKMetadata(sessionId ?? null)

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
    // 有 pending 权限请求时禁用发送
    const hasPendingPermission = Boolean(agentState?.requests && Object.keys(agentState.requests).length > 0)
    const canSend = (hasText || hasAttachments) && !controlsDisabled && !running && !sending && !hasPendingPermission

    // 是否展示命令参数幽灵提示
    const showGhostHint = !!activeCommand?.hint
        && text === `${activeCommand.value} `
        && !slashOpen

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const showSettingsButton = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)

    const modelSelectOptions = useMemo(() => {
        if (sdkMetadata?.models && sdkMetadata.models.length > 0) {
            return sdkMetadata.models.map((m: ModelOption) => ({
                value: m.value,
                label: m.displayName,
                description: m.description,
            }))
        }
        return CLAUDE_MODEL_FALLBACK.map(opt => ({
            value: opt.value,
            label: opt.displayName,
        }))
    }, [sdkMetadata?.models])

    const effortSelectOptions = useMemo(() => getEffortOptions(), [])

    const permissionSelectOptions = useMemo(
        () => permissionModeOptions.map(opt => {
            const color = opt.tone !== 'neutral'
                ? getPermissionModeColor(token, opt.tone)
                : undefined
            return {
                value: opt.mode,
                label: color
                    ? <span style={{ color }}>{t(`composer.permissionModes.${opt.mode}`)}</span>
                    : t(`composer.permissionModes.${opt.mode}`),
            }
        }),
        [permissionModeOptions, t, token]
    )

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
        // Ctrl+C：有内容则清空，无内容且 running 则 abort
        if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            if (text.length > 0) {
                e.preventDefault()
                setText('')
                setActiveCommand(null)
                setSlashOpen(false)
                setSlashFilter('')
                setSuggestionOpen(false)
                setMentionInput(null)
            } else if (running && onAbort && !abortPending) {
                e.preventDefault()
                onAbort()
            }
            return
        }

        // Escape：先关闭 dropdown，再 abort
        if (e.key === 'Escape') {
            if (slashOpen) {
                e.preventDefault()
                setSlashOpen(false)
                setSlashFilter('')
            } else if (suggestionOpen) {
                e.preventDefault()
                setSuggestionOpen(false)
                setMentionInput(null)
            } else if (running && onAbort && !abortPending) {
                e.preventDefault()
                onAbort()
            }
            return
        }

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
        }
    }, [text, running, onAbort, abortPending, slashOpen, slashCommands, slashActiveIndex, handleSlashSelect, suggestionOpen, fileEntries, activeIndex, handleItemSelect])

    const needsRefocusRef = useRef(false)

    // disabled 结束后恢复焦点（发送 mutation 完成时 disabled 从 true 变回 false）
    useEffect(() => {
        if (!controlsDisabled && needsRefocusRef.current) {
            needsRefocusRef.current = false
            requestAnimationFrame(() => {
                getTextarea(wrapperRef.current)?.focus()
            })
        }
    }, [controlsDisabled])

    const handleSubmit = useCallback((content: string) => {
        if (!canSend) return
        if (suggestionOpen || slashOpen) return
        onSend(content.trim())
        setText('')
        setAttachments([])
        setActiveCommand(null)
        needsRefocusRef.current = true
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

    // permission mode 颜色
    const permissionModeTone = permissionMode !== 'default' ? getPermissionModeTone(permissionMode) : null
    const permissionModeColor = getPermissionModeColor(token, permissionModeTone) ?? undefined

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
            {/* 缩小 Select dropdown option 字体 */}
            {COMPACT_DROPDOWN_STYLE}
            {/* 信息面板：权限请求、任务列表等 */}
            <ComposerInfoPanel
                sessionId={sessionId}
                agentState={agentState}
                metadata={metadata ?? null}
                api={api}
                disabled={disabled || sending}
                onPermissionDone={() => {
                    // 权限操作完成后，session 会通过 SSE 更新
                }}
            />

            <StatusBar
                running={running}
                contextSize={contextSize}
                model={model}
                permissionMode={permissionMode}
                agentFlavor={agentFlavor}
                onAbort={onAbort}
                abortPending={abortPending}
            />

            <div ref={wrapperRef} className={isBashMode ? 'bash-mode' : undefined} style={{ position: 'relative' }}>
                <Sender
                    value={text}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    submitType="shiftEnter"
                    onCancel={onAbort}
                    placeholder={isBashMode ? t('composer.bashPlaceholder') : t('composer.placeholder')}
                    disabled={controlsDisabled || showInactiveCover || showLocalModeCover || hasPendingPermission}
                    loading={sending}
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    onKeyDown={handleKeyDown}
                    header={headerNodes.length > 0 ? headerNodes : null}
                    suffix={(_, { components: { ClearButton } }) => hasText ? (
                        <ClearButton
                            size="small"
                            onClick={() => {
                                setText('')
                                setActiveCommand(null)
                            }}
                        />
                    ) : false}
                    footer={(oriNode) => (
                        <ResponsiveActionBar
                            items={[
                                // 附件
                                {
                                    key: 'attach',
                                    label: t('composer.attach'),
                                    render: () => (
                                        <Tooltip title={t('composer.attach')}>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<PaperClipOutlined />}
                                                onClick={handleAttach}
                                                disabled={controlsDisabled || showLocalModeCover || hasPendingPermission}
                                                style={{ borderRadius: '50%' }}
                                            />
                                        </Tooltip>
                                    ),
                                },
                                // permissionmode
                                ...(showSettingsButton ? [{
                                    key: 'permission',
                                    render: () => (
                                        <CompactHoverSelect
                                            $token={token}
                                            prefix={<SafetyOutlined style={{ fontSize: 12, opacity: 0.55, color: permissionModeColor }} />}
                                            value={permissionMode ?? 'default'}
                                            onChange={v => onPermissionModeChange?.(v as PermissionMode)}
                                            disabled={controlsDisabled || showLocalModeCover}
                                            options={permissionSelectOptions}
                                            style={{ color: permissionModeColor }}
                                        />
                                    ),
                                }] : []),
                                // model
                                ...(onModelChange ? [{
                                    key: 'model',
                                    render: () => (
                                        <CompactHoverSelect
                                            $token={token}
                                            prefix={<RobotOutlined style={{ fontSize: 12, opacity: 0.55 }} />}
                                            value={model ?? 'auto'}
                                            onChange={v => onModelChange(v as string | null)}
                                            disabled={controlsDisabled || showLocalModeCover}
                                            options={modelSelectOptions}
                                            optionRender={(option) => {
                                                const desc = (option.data as { description?: string })?.description
                                                return (
                                                    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 240, overflow: 'hidden' }}>
                                                        <span>{option.label}</span>
                                                        {desc && (
                                                            <Typography.Text
                                                                type="secondary"
                                                                ellipsis={{ tooltip: desc }}
                                                                style={{ fontSize: 11, lineHeight: '16px' }}
                                                            >
                                                                {desc}
                                                            </Typography.Text>
                                                        )}
                                                    </div>
                                                )
                                            }}
                                        />
                                    ),
                                }] : []),
                                // effort
                                ...(onEffortChange ? [{
                                    key: 'effort',
                                    render: () => (
                                        <CompactHoverSelect
                                            $token={token}
                                            prefix={<ThunderboltOutlined style={{ fontSize: 12, opacity: 0.55 }} />}
                                            value={effort}
                                            onChange={v => onEffortChange(v as EffortLevel)}
                                            disabled={controlsDisabled || showLocalModeCover}
                                            options={effortSelectOptions}
                                        />
                                    ),
                                }] : []),
                                // file terminal
                                ...(extraItems ?? []),
                                // exit
                                ...(onArchive && active ? [{
                                    key: 'archive',
                                    label: t('session.actions.archive'),
                                    render: () => (
                                        <Tooltip title={t('session.actions.archive')}>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<LogoutOutlined />}
                                                loading={archivePending}
                                                onClick={onArchive}
                                                style={{ borderRadius: '50%' }}
                                            />
                                        </Tooltip>
                                    ),
                                }] : []),
                                // 已废弃：extraLeftButtons 回退
                                ...(extraLeftButtons && !extraItems ? [{
                                    key: 'extra',
                                    render: () => extraLeftButtons,
                                }] : []),
                            ]}
                            suffix={showLocalModeCover ? null : oriNode}
                            gap={4}
                        />
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
