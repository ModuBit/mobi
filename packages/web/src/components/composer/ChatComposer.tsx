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
import { Button, Tooltip, Select, theme, Typography, Popover, message } from 'antd'
import { PlusOutlined, PlayCircleOutlined, SwapOutlined, LogoutOutlined, SafetyOutlined, RightOutlined } from '@ant-design/icons'
import { Sender } from '@ant-design/x'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { AgentState, EffortLevel, PermissionMode, Session, TodoItem, TaskItem } from '@mobi/shared'
import { getPermissionModeOptionsForFlavor, getPermissionModeTone, EFFORT_LEVELS, EFFORT_LABELS } from '@mobi/shared'
import { CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import { StatusBar } from './StatusBar'
import { AttachmentList } from './AttachmentItem'
import { ComposerInfoPanel } from './ComposerInfoPanel'
import type { SessionMetadataSummary, UploadFileResponse } from '@/core/data/api/types'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useMentionInteraction } from './useMentionInteraction'
import { useSlashCommandInteraction } from './useSlashCommandInteraction'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { createFileAttachment, validateFile, getAcceptExtensions } from '@/core/lib/fileAttachments'
import { useCommands } from '@/core/data/hooks/queries/useCommands'
import { useSDKMetadata, type ModelOption } from '@/core/data/hooks/queries/useSDKMetadata'
import { shouldNotForwardDollarProps } from '@/core/lib/styledUtils'
import { MentionDropdown } from './MentionDropdown'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { CommandHintBar } from './CommandHintBar'
import { ResponsiveActionBar, type ActionItem } from './ResponsiveActionBar'
import { getPermissionModeColor } from './permissionModeColors'
import { useHasFinePointer } from '@/core/data/hooks/useMediaQuery'


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
    todos?: TodoItem[]
    tasks?: TaskItem[]
}

function getTextarea(wrapper: HTMLDivElement | null): HTMLTextAreaElement | null {
    return wrapper?.querySelector('textarea') ?? null
}

// 带 filled 背景的紧凑 Select
const HoverSelect = styled(Select, {
    shouldForwardProp: shouldNotForwardDollarProps,
})<{
    $token: ReturnType<typeof theme.useToken>['token']
    $compact?: boolean
}>`
    border-radius: ${props => props.$token.borderRadiusSM}px;
    transition: background 0.2s;
    ${props => props.$compact && `
        height: 24px !important;
        &&& .ant-select-input {
            font-size: 12px !important;
        }
    `}
`

// 缩小 dropdown 弹出层的 option 字体（全局注入一次）
const COMPACT_DROPDOWN_CLASS = 'compact-select-dropdown'
const MODEL_DROPDOWN_CLASS = 'model-select-dropdown'
let compactStyleInjected = false
function useCompactDropdownStyle() {
    if (!compactStyleInjected && typeof document !== 'undefined') {
        const style = document.createElement('style')
        style.textContent = `
.${COMPACT_DROPDOWN_CLASS} .ant-select-item-option { font-size: 12px !important; padding: 4px 8px !important; min-height: auto !important; }
.${COMPACT_DROPDOWN_CLASS} { max-width: 100vw !important; }
@media (max-width: 640px) {
    .${MODEL_DROPDOWN_CLASS} { right: auto !important; left: 12px !important; max-width: calc(100vw - 24px) !important; }
}
.effort-popover .ant-popover-container { padding: 4px 0 !important; }
.effort-popover .ant-popover-arrow { display: none !important; }
.effort-popover .effort-item:hover { background: var(--ant-color-bg-text-hover) !important; }
.effort-popover .effort-arrow { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; border-radius: 4px; }
.effort-popover .effort-arrow:hover { background: var(--ant-color-bg-text-hover); }
`
        document.head.appendChild(style)
        compactStyleInjected = true
    }
}

// Footer Bar / Sub Bar 中 icon 按钮的统一样式
const ACTION_BUTTON_STYLE: React.CSSProperties = {
    borderRadius: 'var(--ant-border-radius-sm, 6px)',
    background: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.06))',
} as const

// 预配置的紧凑 Select，复用共享样式属性
function CompactHoverSelect(props: Omit<React.ComponentProps<typeof HoverSelect>, 'size' | 'variant' | 'popupMatchSelectWidth' | '$compact'>) {
    useCompactDropdownStyle()
    const { classNames: propsClassNames, ...rest } = props
    const extraPopupRoot = (propsClassNames as any)?.popup?.root as string | undefined
    return (
        <HoverSelect
            {...rest}
            $compact
            size="small"
            variant="filled"
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: [COMPACT_DROPDOWN_CLASS, extraPopupRoot].filter(Boolean).join(' ') } }}
        />
    )
}

// ============ 粘贴图片 MIME → 扩展名 ============
const MIME_TO_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
}

/** 从图片 MIME 类型推断文件扩展名，未知类型回退到 .png */
function imageExtFromMime(mimeType: string): string {
    return MIME_TO_EXT[mimeType] ?? '.png'
}

// ============ Effort 级别颜色 ============
const EFFORT_COLORS: Record<EffortLevel, string> = {
    low: 'var(--ant-color-text-quaternary)',
    medium: 'var(--ant-color-info)',
    high: 'var(--ant-color-warning)',
    xhigh: 'var(--ant-color-error)',
}

function EffortDot({ level }: { level: EffortLevel }) {
    return (
        <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: EFFORT_COLORS[level],
            flexShrink: 0,
        }} />
    )
}

// model option 中的 effort 选择 Popover 内容
function EffortPopoverContent({ modelValue, effort, onEffortSelect }: {
    modelValue: string
    effort: EffortLevel
    onEffortSelect: (model: string, effort: EffortLevel) => void
}) {
    const { token } = theme.useToken()
    const [hovered, setHovered] = useState<string | null>(null)
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 }}>
            {EFFORT_LEVELS.map(e => (
                <div
                    key={e}
                    onClick={(ev) => { ev.stopPropagation(); onEffortSelect(modelValue, e) }}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', margin: '0 4px', borderRadius: token.borderRadiusSM,
                        cursor: 'pointer',
                        background: e === effort ? token.colorBgTextHover
                            : hovered === e ? token.colorBgTextHover : undefined,
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={() => setHovered(e)}
                    onMouseLeave={() => setHovered(null)}
                >
                    <EffortDot level={e} />
                    <span style={{ fontSize: 12 }}>{EFFORT_LABELS[e]}</span>
                </div>
            ))}
        </div>
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
    const hasFinePointer = useHasFinePointer()

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
        todos,
        tasks,
    } = props

    const [text, setText] = useState('')
    const [attachments, setAttachments] = useState<FileAttachment[]>([])
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
    const [effortPopoverModel, setEffortPopoverModel] = useState<string | null>(null)

    // 命令列表（复用 React Query 缓存，用于手动输入时匹配参数提示）
    const { data: commandsData } = useCommands(sessionId ?? null)

    // SDK 元数据（模型列表等）
    const { data: sdkMetadata } = useSDKMetadata(sessionId ?? null)

    const wrapperRef = useRef<HTMLDivElement>(null)
    const pendingCursorRef = useRef<number | null>(null)

    // 随机 placeholder 索引，每次挂载只选一次
    const placeholders = t('composer.placeholders', { returnObjects: true }) as string[]
    const placeholderIdx = useRef(Math.floor(Math.random() * placeholders.length))

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
    const hasSubBar = !!extraItems?.length || !!(onArchive && active) || !!(extraLeftButtons && !extraItems)

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
                label: m.displayName.replace(/\s*\([^()]*\)\s*$/, ''),
                description: m.description,
            }))
        }
        return CLAUDE_MODEL_FALLBACK.map(opt => ({
            value: opt.value,
            label: opt.displayName,
        }))
    }, [sdkMetadata?.models])

    // model + effort 合并选择
    const handleModelEffortSelect = useCallback((selectedModel: string, selectedEffort: EffortLevel) => {
        if (selectedModel !== model) onModelChange?.(selectedModel)
        if (selectedEffort !== effort) onEffortChange?.(selectedEffort)
    }, [model, effort, onModelChange, onEffortChange])

    const handleModelSelect = useCallback((v: string) => {
        if (v !== model) onModelChange?.(v)
    }, [model, onModelChange])

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

        // 检查是否有未完成上传的附件
        const pendingUploads = attachments.filter(a => a.status === 'uploading')
        if (pendingUploads.length > 0) {
            message.warning('请等待文件上传完成')
            return
        }

        // 拼接附件路径到消息文本
        const completedAttachments = attachments.filter(a => a.status === 'complete' && a.path)
        const attachmentPaths = completedAttachments.map(a => `@${a.path}`).join('\n')
        const finalText = attachmentPaths
            ? `${content.trim()}\n${attachmentPaths}`
            : content.trim()

        if (!finalText) return

        onSend(finalText)
        setText('')
        setAttachments([])
        needsRefocusRef.current = true
    }, [canSend, onSend, mention.isOpen, slash.isOpen, attachments])

    // 上传附件到服务器
    const uploadAttachment = useCallback(async (attachmentId: string, file: File) => {
        const controller = new AbortController()
        abortControllersRef.current.set(attachmentId, controller)
        try {
            const response = await api.sessions.upload(sessionId, file, { signal: controller.signal })
            const data = response.data as UploadFileResponse
            if (data.success && data.path) {
                setAttachments(prev => prev.map(a =>
                    a.id === attachmentId
                        ? { ...a, status: 'complete' as const, path: data.path }
                        : a
                ))
            } else {
                setAttachments(prev => prev.map(a =>
                    a.id === attachmentId
                        ? { ...a, status: 'error' as const, error: data.error || '上传失败' }
                        : a
                ))
            }
        } catch (err) {
            // 被取消的上传静默忽略
            if (controller.signal.aborted) return
            setAttachments(prev => prev.map(a =>
                a.id === attachmentId
                    ? { ...a, status: 'error' as const, error: err instanceof Error ? err.message : '上传失败' }
                    : a
            ))
        } finally {
            abortControllersRef.current.delete(attachmentId)
        }
    }, [api, sessionId])

    const handleAttach = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = getAcceptExtensions()
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files
            if (!files) return
            for (const file of Array.from(files)) {
                const error = validateFile(file)
                if (error) {
                    message.warning(error)
                    continue
                }
                const attachment = createFileAttachment(file)
                setAttachments(prev => [...prev, attachment])
                uploadAttachment(attachment.id, file)
            }
        }
        input.click()
    }, [uploadAttachment])

    const handleRemoveAttachment = useCallback((id: string) => {
        // 取消进行中的上传
        const controller = abortControllersRef.current.get(id)
        if (controller) {
            controller.abort()
            abortControllersRef.current.delete(id)
        }

        setAttachments(prev => {
            const attachment = prev.find(a => a.id === id)
            // 如果文件已上传成功，通知服务器删除
            if (attachment?.status === 'complete' && attachment.path) {
                api.sessions.deleteUpload(sessionId, attachment.path).catch(() => {
                    // 删除失败静默处理
                })
            }
            return prev.filter(a => a.id !== id)
        })
    }, [api, sessionId])

    // 粘贴上传处理
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items
        if (!items) return

        // 检测是否有文件项
        const fileItems = Array.from(items).filter(item => item.kind === 'file')
        if (fileItems.length === 0) return

        // 阻止浏览器默认粘贴行为，避免文件名等文本被插入 textarea
        e.preventDefault()

        for (const item of fileItems) {
            const file = item.getAsFile()
            if (!file) continue

            // 为粘贴的文件生成文件名（从 MIME 推断扩展名）
            const isImage = file.type.startsWith('image/')
            const ext = isImage ? imageExtFromMime(file.type) : ''
            const fileName = isImage
                ? `paste-${Date.now()}${ext}`
                : `paste-${Date.now()}-${file.name || 'file'}`

            // 创建新的 File 对象以设置文件名
            const namedFile = new File([file], fileName, { type: file.type })

            // 校验
            const error = validateFile(namedFile)
            if (error) {
                message.warning(error)
                continue
            }

            // 创建附件并上传
            const attachment = createFileAttachment(namedFile)
            setAttachments(prev => [...prev, attachment])
            uploadAttachment(attachment.id, namedFile)
        }
    }, [uploadAttachment])

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
            {/* 信息面板：工具交互请求、任务列表等 */}
            <ComposerInfoPanel
                sessionId={sessionId}
                agentState={agentState}
                metadata={metadata ?? null}
                api={api}
                disabled={disabled || sending}
                onRequestDone={() => {
                    // 请求交互完成后，session 会通过 SSE 更新
                }}
                todos={todos}
                tasks={tasks}
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
                    submitType={hasFinePointer ? 'enter' : 'shiftEnter'}
                    onCancel={onAbort}
                    placeholder={isBashMode ? t('composer.bashPlaceholder') : t(`composer.placeholders.${placeholderIdx.current}`)}
                    disabled={controlsDisabled || showInactiveCover || showLocalModeCover || hasPendingPermission}
                    loading={sending}
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    header={headerNodes.length > 0 ? headerNodes : null}
                    suffix={false}
                    style={hasSubBar ? {
                        position: 'relative',
                        zIndex: 1,
                        background: 'var(--ant-color-bg-container)',
                    } : undefined}
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
                                                icon={<PlusOutlined />}
                                                onClick={handleAttach}
                                                disabled={controlsDisabled || showLocalModeCover || hasPendingPermission}
                                                style={ACTION_BUTTON_STYLE}
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
                                // model + effort
                                ...(onModelChange ? [{
                                    key: 'model',
                                    render: () => (
                                        <CompactHoverSelect
                                            $token={token}
                                            prefix={<EffortDot level={effort ?? 'medium'} />}
                                            value={model ?? 'auto'}
                                            onChange={v => handleModelSelect(v as string)}
                                            disabled={controlsDisabled || showLocalModeCover}
                                            options={modelSelectOptions}
                                            classNames={{ popup: { root: MODEL_DROPDOWN_CLASS } }}
                                            optionRender={(option) => {
                                                const desc = (option.data as { description?: string })?.description
                                                const modelValue = option.value as string
                                                return (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
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
                                                        {onEffortChange && (
                                                            <Popover
                                                                open={effortPopoverModel === modelValue}
                                                                onOpenChange={(open) => setEffortPopoverModel(open ? modelValue : null)}
                                                                placement="leftTop"
                                                                trigger={hasFinePointer ? 'hover' : 'click'}
                                                                mouseEnterDelay={0.1}
                                                                mouseLeaveDelay={0.3}
                                                                zIndex={1051}
                                                                rootClassName="effort-popover"
                                                                content={
                                                                    <EffortPopoverContent
                                                                        modelValue={modelValue}
                                                                        effort={effort ?? 'medium'}
                                                                        onEffortSelect={(m, e) => {
                                                                            handleModelEffortSelect(m, e)
                                                                            setEffortPopoverModel(null)
                                                                        }}
                                                                    />
                                                                }
                                                            >
                                                                <span
                                                                    style={{
                                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                        minWidth: 24, minHeight: 24, borderRadius: 4, cursor: 'pointer',
                                                                    }}
                                                                    onClick={(ev) => ev.stopPropagation()}
                                                                >
                                                                    <RightOutlined style={{ fontSize: 10, opacity: 0.4 }} />
                                                                </span>
                                                            </Popover>
                                                        )}
                                                    </div>
                                                )
                                            }}
                                        />
                                    ),
                                }] : []),
                            ]}
                            suffix={showLocalModeCover ? null : oriNode}
                            gap={4}
                        />
                    )}
                />

                {/* Sub Bar：Sender 下方次要操作，宽度不够时自动收起 */}
                {hasSubBar && (
                    <div style={{
                        background: 'var(--ant-color-fill-tertiary)',
                        borderBottomLeftRadius: 'var(--ant-border-radius, 8px)',
                        borderBottomRightRadius: 'var(--ant-border-radius, 8px)',
                        // marginTop 需覆盖 Sender 底部圆角区域，与 Sender 的 borderRadius 保持一致
                        padding: '16px 6px 6px',
                        margin: '-12px 6px 0',
                        position: 'relative',
                        zIndex: 0,
                    }}>
                        <ResponsiveActionBar
                            items={[
                                // file terminal
                                ...(extraItems ?? []),
                                // archive
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
                                                style={ACTION_BUTTON_STYLE}
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
                            gap={4}
                        />
                    </div>
                )}

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
