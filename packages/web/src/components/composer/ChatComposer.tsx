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
import { ComposerInfoPanel } from './ComposerInfoPanel'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useMentionInteraction } from './useMentionInteraction'
import { useSlashCommandInteraction } from './useSlashCommandInteraction'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { createFileAttachment } from '@/core/lib/fileAttachments'
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

    // 命令列表（复用 React Query 缓存，用于手动输入时匹配参数提示）
    const { data: commandsData } = useCommands(sessionId ?? null)

    // SDK 元数据（模型列表等）
    const { data: sdkMetadata } = useSDKMetadata(sessionId ?? null)

    const wrapperRef = useRef<HTMLDivElement>(null)
    const pendingCursorRef = useRef<number | null>(null)

    // @ 文件引用交互
    const mention = useMentionInteraction({
        sessionId,
        workingDir,
    })

    // / 斜杠命令交互
    const slash = useSlashCommandInteraction({
        sessionId,
        workingDir,
        commandsData,
    })

    const controlsDisabled = disabled || (!active && !allowSendWhenInactive)
    const trimmed = text.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0
    // 有 pending 权限请求时禁用发送
    const hasPendingPermission = Boolean(agentState?.requests && Object.keys(agentState.requests).length > 0)
    const canSend = (hasText || hasAttachments) && !controlsDisabled && !running && !sending && !hasPendingPermission

    // 是否展示命令参数幽灵提示
    const showGhostHint = !!slash.activeCommand?.hint
        && text === `${slash.activeCommand.value} `
        && !slash.isOpen

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
        if (!mention.isOpen && !slash.isOpen) return
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                mention.close()
                slash.close()
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [mention.isOpen, slash.isOpen, mention, slash])

    // 光标位置恢复（无 deps：需要在每次 React commit 后检查 pending 状态）
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

        // Slash 检测优先（内部同时处理 activeCommand 管理）
        if (slash.processChange(value, cursorPos)) {
            mention.close()
            return
        }

        // Mention 检测
        if (mention.processChange(value, cursorPos)) {
            return
        }
        mention.close()
    }, [mention, slash])

    // Tab 键选中（需用 native listener 因为 Sender 的 onKeyDown 会先消费 Tab）
    const textRef = useRef(text)
    textRef.current = text

    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) return
        if (!mention.isOpen && !slash.isOpen) return

        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return
            e.preventDefault()
            e.stopPropagation()
            if (slash.isOpen && slash.items.length > 0) {
                const result = slash.selectCurrent(textRef.current)
                if (result) {
                    setText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
            } else if (mention.isOpen && mention.items.length > 0) {
                const result = mention.selectCurrent(textRef.current)
                if (result) {
                    setText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
            }
        }

        wrapper.addEventListener('keydown', handler, true)
        return () => wrapper.removeEventListener('keydown', handler, true)
    }, [mention.isOpen, mention, slash.isOpen, slash])

    // 键盘导航
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Ctrl+C：有内容则清空，无内容且 running 则 abort
        if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
            if (textRef.current.length > 0) {
                e.preventDefault()
                setText('')
                mention.close()
                slash.reset()
            } else if (running && onAbort && !abortPending) {
                e.preventDefault()
                onAbort()
            }
            return
        }

        // Escape：先委托给各 hook，都未消费则 abort
        if (e.key === 'Escape') {
            if (slash.handleKeyDown(e)) return
            if (mention.handleKeyDown(e)) return
            if (running && onAbort && !abortPending) {
                e.preventDefault()
                onAbort()
            }
            return
        }

        // Enter 键选中
        if (e.key === 'Enter') {
            if (slash.isOpen && slash.items.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                const result = slash.selectCurrent(textRef.current)
                if (result) {
                    setText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
                return
            }
            if (mention.isOpen && mention.items.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                const result = mention.selectCurrent(textRef.current)
                if (result) {
                    setText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
                return
            }
            return
        }

        // Arrow 键导航
        if (slash.handleKeyDown(e)) return
        if (mention.handleKeyDown(e)) return
    }, [running, onAbort, abortPending, mention, slash])

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
        if (mention.isOpen || slash.isOpen) return
        onSend(content.trim())
        setText('')
        setAttachments([])
        needsRefocusRef.current = true
    }, [canSend, onSend, mention.isOpen, slash.isOpen])

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

    const permissionModeTone = permissionMode !== 'default' ? getPermissionModeTone(permissionMode) : null
    const permissionModeColor = getPermissionModeColor(token, permissionModeTone) ?? undefined

    // Sender header 区域内容（可组合，多条可共存）
    const headerNodes = [
        showGhostHint && slash.activeCommand && (
            <CommandHintBar key="hint" hint={slash.activeCommand.hint} />
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
                                mention.close()
                                slash.reset()
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
                {mention.isOpen && (
                    <MentionDropdown
                        items={mention.items}
                        loading={mention.isLoading}
                        activeIndex={mention.activeIndex}
                        scrollIntoActive={mention.scrollIntoActive}
                        onSelect={(item) => {
                            const result = mention.selectItem(item, text)
                            if (result) {
                                setText(result.text)
                                pendingCursorRef.current = result.cursorPos
                            }
                        }}
                        onHover={mention.setActiveIndex}
                    />
                )}

                {/* slash command 下拉 */}
                {slash.isOpen && (
                    <SlashCommandDropdown
                        items={slash.items}
                        loading={slash.isLoading}
                        activeIndex={slash.activeIndex}
                        scrollIntoActive={slash.scrollIntoActive}
                        onSelect={(item) => {
                            const result = slash.selectItem(item, text)
                            if (result) {
                                setText(result.text)
                                pendingCursorRef.current = result.cursorPos
                            }
                        }}
                        onHover={slash.setActiveIndex}
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
