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
import { App, Button, Tooltip, Select, Spin, Popover, theme as antTheme } from 'antd'
import { Sender } from '@ant-design/x'
import { PlusOutlined, InboxOutlined, SafetyOutlined, RightOutlined } from '@ant-design/icons'
import { Cpu } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import styled from '@emotion/styled'
import type { EffortLevel, PermissionMode } from '@mobi/shared'
import { EFFORT_LEVELS, EFFORT_LABELS, PERMISSION_MODES, PERMISSION_MODE_LABELS } from '@mobi/shared'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useSpawnSession, type SpawnInput } from '@/core/data/hooks/mutations/useSpawnSession'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import { useDirectoryCapabilities, type CapabilityTarget } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import { useDirectoryCommands } from '@/components/composer/useDirectoryCommands'
import { useAttachmentHandling } from '@/components/composer/useAttachmentHandling'
import { useMentionInteraction } from '@/components/composer/useMentionInteraction'
import { useSlashCommandInteraction } from '@/components/composer/useSlashCommandInteraction'
import { MentionDropdown } from '@/components/composer/MentionDropdown'
import { SlashCommandDropdown } from '@/components/composer/SlashCommandDropdown'
import { AttachmentList } from '@/components/composer/AttachmentItem'
import { ResponsiveActionBar, type ActionItem } from '@/components/composer/ResponsiveActionBar'
import { EnvironmentBar, extractProjectName } from '@/components/composer/EnvironmentBar'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { type AgentType, CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
import {
    loadPreferredAgent,
    savePreferredAgent,
    loadPreferredModel,
    savePreferredModel,
    loadPreferredEffort,
    savePreferredEffort,
    loadPreferredPermissionMode,
    savePreferredPermissionMode,
} from '@/domain/session/preferences'
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { useHasFinePointer } from '@/core/data/hooks/useMediaQuery'
import { getPermissionModeColor } from '@/components/composer/permissionModeColors'
import { shouldNotForwardDollarProps } from '@/core/lib/styledUtils'

const { useToken } = antTheme

/* ========== 常量 ========== */

const PERMISSION_OPTIONS = PERMISSION_MODES.map(m => ({
    value: m,
    label: PERMISSION_MODE_LABELS[m],
}))

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex' },
]

const ACTION_BUTTON_STYLE: React.CSSProperties = {
    borderRadius: 'var(--ant-border-radius-sm, 6px)',
    background: 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.06))',
} as const

// Effort 级别颜色
const EFFORT_COLORS: Record<EffortLevel, string> = {
    low: 'var(--ant-color-text-quaternary)',
    medium: 'var(--ant-color-info)',
    high: 'var(--ant-color-warning)',
    xhigh: 'var(--ant-color-error)',
}

// compact dropdown 样式注入（全局一次）
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

/* ========== 样式组件 ========== */

const PageContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    position: relative;
`

const SidebarToggleWrapper = styled.div`
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 10;
`

const ContentWrapper = styled.div`
    max-width: 720px;
    width: 100%;
    padding: 0 24px;
`

const TitleBar = styled.div<{ $color: string }>`
    text-align: center;
    font-size: 24px;
    font-weight: 600;
    color: ${props => props.$color};
    line-height: 1.4;
    margin-bottom: 32px;
`

const HoverSelect = styled(Select, {
    shouldForwardProp: shouldNotForwardDollarProps,
})<{
    $token: ReturnType<typeof antTheme.useToken>['token']
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

/* ========== 辅助组件 ========== */

/** Effort 级别小圆点 */
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

/** model option 中的 effort 选择 Popover 内容 */
function EffortPopoverContent({ modelValue, effort, onEffortSelect }: {
    modelValue: string
    effort: EffortLevel
    onEffortSelect: (model: string, effort: EffortLevel) => void
}) {
    const { token } = antTheme.useToken()
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

/* ========== 页面组件 ========== */

/**
 * 新建会话页面
 *
 * 状态机：gate（未选机器+目录） → create（空输入） → send（有内容）
 * 两步创建：spawnSession → sendMessage → navigate
 * 两行 Sender 布局：Row 1 = 环境选择 | Row 2 = 配置 + 操作
 */
export function NewSessionPage() {
    const { token } = useToken()
    const { message: messageApi } = App.useApp()
    const navigate = useNavigate()
    const authToken = useAuthStore((state) => state.token)
    const api = useMobiApi(authToken)
    const hasFinePointer = useHasFinePointer()

    // 偏好配置（初始化从 localStorage 加载）
    const [agent, setAgent] = useState<AgentType>(() => loadPreferredAgent())
    const [model, setModel] = useState(() => loadPreferredModel())
    const [effort, setEffort] = useState<EffortLevel>(() => loadPreferredEffort())
    const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => loadPreferredPermissionMode())

    // 环境配置
    const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
    const [selectedDirectory, setSelectedDirectory] = useState('')
    const [inputText, setInputText] = useState('')
    const [isPending, setIsPending] = useState(false)

    // effort popover 状态
    const [effortPopoverModel, setEffortPopoverModel] = useState<string | null>(null)

    // 数据
    const { machines, isLoading: isLoadingMachines } = useMachines()
    const { spawnSession } = useSpawnSession()
    const { options: directoryOptions } = useMachineDirectoryListing(
        selectedMachineId,
        selectedDirectory,
    )

    const activeMachines = machines.filter(m => m.active)

    // 能力目标（基于 machine + cwd），useMemo 保证引用稳定，避免下游 useEffect 无限循环
    const capTarget = useMemo<CapabilityTarget | null>(() => {
        return (selectedMachineId && selectedDirectory)
            ? { kind: 'machine', machineId: selectedMachineId, cwd: selectedDirectory }
            : null
    }, [selectedMachineId, selectedDirectory])
    const capabilities = useDirectoryCapabilities(capTarget)
    const { data: commandsData, isLoading: commandsLoading } = useDirectoryCommands(capabilities)

    // 附件管理（共享 hook）
    const {
        attachments, isDragOver,
        handleAttach, handleRemoveAttachment, handlePaste,
        handleDragEnter, handleDragOver, handleDragLeave, handleDrop,
    } = useAttachmentHandling(capabilities)

    // @ 文件引用交互
    const mention = useMentionInteraction({
        target: capTarget,
        searchFiles: capabilities.searchFiles,
        listDirectory: capabilities.listDirectory,
        workingDir: selectedDirectory || undefined,
    })

    // / 斜杠命令交互
    const slash = useSlashCommandInteraction({
        commandsData,
        commandsLoading,
        workingDir: selectedDirectory || undefined,
    })

    const wrapperRef = useRef<HTMLDivElement>(null)
    const pendingCursorRef = useRef<number | null>(null)

    // ref 持有最新值，避免 handleSubmit 因 attachments/inputText 变化而重建
    const inputTextRef = useRef(inputText)
    inputTextRef.current = inputText
    const attachmentsRef = useRef(attachments)
    attachmentsRef.current = attachments

    // Gate：是否已选好环境
    const gatePassed = !!(selectedMachineId && selectedDirectory)
    const hasContent = inputText.trim().length > 0
    const hasAttachments = attachments.length > 0
    const inputDisabled = !gatePassed

    // 动态标题
    const projectName = selectedDirectory ? extractProjectName(selectedDirectory) : null
    const title = useMemo(() => {
        const titles = projectName
            ? [`我们想在 ${projectName} 中构建什么？`, `来聊聊 ${projectName} 吧`, `在 ${projectName} 中开始新对话`]
            : ['你想做什么？', '有什么新想法？', '开始一段新对话']
        return titles[Math.floor(Math.random() * titles.length)]
    }, [projectName])

    // 是否展示命令参数幽灵提示
    const showGhostHint = !!slash.activeCommand?.hint
        && inputText === `${slash.activeCommand.value} `
        && !slash.isOpen

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

    // 光标位置恢复
    useEffect(() => {
        if (pendingCursorRef.current != null) {
            const textarea = wrapperRef.current?.querySelector('textarea')
            if (textarea) {
                textarea.selectionStart = textarea.selectionEnd = pendingCursorRef.current
                textarea.focus()
            }
            pendingCursorRef.current = null
        }
    })

    // ============ 文本变更处理 ============
    const handleChange = useCallback((value: string) => {
        setInputText(value)

        const textarea = wrapperRef.current?.querySelector('textarea')
        const cursorPos = textarea?.selectionStart ?? value.length

        // Slash 检测优先
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

    // Tab 键选中
    const textRef = useRef(inputText)
    textRef.current = inputText

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
                    setInputText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
            } else if (mention.isOpen && mention.items.length > 0) {
                const result = mention.selectCurrent(textRef.current)
                if (result) {
                    setInputText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
            }
        }

        wrapper.addEventListener('keydown', handler, true)
        return () => wrapper.removeEventListener('keydown', handler, true)
    }, [mention.isOpen, mention, slash.isOpen, slash])

    // 键盘导航
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            if (slash.handleKeyDown(e)) return
            if (mention.handleKeyDown(e)) return
            return
        }

        if (e.key === 'Enter') {
            if (slash.isOpen && slash.items.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                const result = slash.selectCurrent(textRef.current)
                if (result) {
                    setInputText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
                return
            }
            if (mention.isOpen && mention.items.length > 0) {
                e.preventDefault()
                e.stopPropagation()
                const result = mention.selectCurrent(textRef.current)
                if (result) {
                    setInputText(result.text)
                    pendingCursorRef.current = result.cursorPos
                }
                return
            }
            return
        }

        if (slash.handleKeyDown(e)) return
        if (mention.handleKeyDown(e)) return
    }, [mention, slash])

    // ============ 提交处理 ============
    const handleSubmit = useCallback(async () => {
        if (!selectedMachineId || !selectedDirectory || isPending) return
        // 空输入时不允许 Enter 触发（但允许按钮点击创建空会话）
        // 注意：空输入 + 按钮点击 = 仅创建空会话；有内容 = 创建 + 发送
        setIsPending(true)

        // 从 ref 读取最新值
        const currentText = inputTextRef.current.trim()
        const currentAttachments = attachmentsRef.current

        // 持久化配置
        savePreferredAgent(agent)
        savePreferredModel(model)
        savePreferredEffort(effort)
        savePreferredPermissionMode(permissionMode)

        try {
            const input: SpawnInput = {
                machineId: selectedMachineId,
                directory: selectedDirectory || '/',
                agent,
                model: model === 'auto' ? undefined : model,
                effort,
                yolo: permissionMode === 'bypassPermissions',
            }

            const result = await spawnSession(input)

            if (result.type !== 'success' || !result.sessionId) {
                messageApi.error(result.type === 'error' ? (result.message || '创建会话失败') : '创建会话失败')
                return
            }

            const sessionId = result.sessionId

            // 有内容时发送消息
            if (currentText || currentAttachments.length > 0) {
                try {
                    // 拼接附件路径到消息文本（与 ChatComposer 一致）
                    const completedAttachments = currentAttachments.filter(a => a.status === 'complete' && a.path)
                    const attachmentPaths = completedAttachments.map(a => `@${a.path}`).join('\n')
                    const finalText = attachmentPaths
                        ? `${currentText}\n${attachmentPaths}`
                        : currentText

                    if (finalText) {
                        await api.messages.send(sessionId, finalText)
                    }
                } catch {
                    // 发送失败仍然导航到详情页，用户可重试
                }
            }

            navigate({ to: '/sessions/$sessionId', params: { sessionId } })
        } catch (e) {
            messageApi.error(e instanceof Error ? e.message : '创建会话失败')
        } finally {
            setIsPending(false)
        }
    }, [
        selectedMachineId, selectedDirectory, isPending,
        agent, model, effort, permissionMode,
        spawnSession, navigate, messageApi, api.messages,
    ])

    // ============ 按钮文案 ============
    const submitLabel = !gatePassed
        ? '请先选择机器和目录'
        : hasContent
            ? '发送 ↑'
            : '创建'

    // ============ 机器选项 ============
    const machineOptions = activeMachines.map(m => ({
        value: m.id,
        label: m.metadata?.displayName || m.metadata?.host || m.id,
    }))

    // ============ model + effort 合并选择 ============
    const modelSelectOptions = useMemo(() => {
        return CLAUDE_MODEL_FALLBACK.map(opt => ({
            value: opt.value,
            label: opt.displayName,
        }))
    }, [])

    const handleModelEffortSelect = useCallback((selectedModel: string, selectedEffort: EffortLevel) => {
        if (selectedModel !== model) setModel(selectedModel)
        if (selectedEffort !== effort) setEffort(selectedEffort)
    }, [model, effort])

    const handleModelSelect = useCallback((v: string) => {
        if (v !== model) setModel(v)
    }, [model])

    // permission mode 选项（带颜色）
    const permissionSelectOptions = useMemo(
        () => PERMISSION_OPTIONS.map(opt => {
            const mode = opt.value as PermissionMode
            const tone = mode !== 'default' ? (
                mode === 'bypassPermissions' ? 'danger' : 'warning'
            ) : null
            const color = tone ? getPermissionModeColor(token, tone) : undefined
            return {
                value: opt.value,
                label: color
                    ? <span style={{ color }}>{opt.label}</span>
                    : opt.label,
            }
        }),
        [token]
    )

    const permissionModeTone = permissionMode !== 'default' ? (
        permissionMode === 'bypassPermissions' ? 'danger' : 'warning'
    ) : null
    const permissionModeColor = getPermissionModeColor(token, permissionModeTone) ?? undefined

    // ============ ActionItems ============

    // Row 2: 配置 + 操作
    const row2Items: ActionItem[] = useMemo(() => [
        // 附件按钮
        {
            key: 'attach',
            label: '附件',
            render: () => (
                <Tooltip title="添加附件">
                    <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={handleAttach}
                        disabled={inputDisabled}
                        style={ACTION_BUTTON_STYLE}
                    />
                </Tooltip>
            ),
        },
        // Agent 选择
        {
            key: 'agent',
            label: 'Agent',
            render: () => (
                <CompactHoverSelect
                    $token={token}
                    prefix={<Cpu size={12} style={{ opacity: 0.55 }} />}
                    value={agent}
                    onChange={v => setAgent(v as AgentType)}
                    disabled={inputDisabled}
                    options={AGENT_OPTIONS.map(a => ({ value: a.value, label: a.label }))}
                />
            ),
        },
        // Model + Effort 选择
        {
            key: 'model',
            label: '模型',
            render: () => (
                <CompactHoverSelect
                    $token={token}
                    prefix={<EffortDot level={effort} />}
                    value={model}
                    onChange={v => handleModelSelect(v as string)}
                    disabled={inputDisabled}
                    options={modelSelectOptions}
                    classNames={{ popup: { root: MODEL_DROPDOWN_CLASS } }}
                    optionRender={(option) => {
                        const modelValue = option.value as string
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                    <span>{option.label}</span>
                                </div>
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
                                            effort={effort}
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
                            </div>
                        )
                    }}
                />
            ),
        },
        // 权限模式（overflow 项）
        {
            key: 'permission',
            label: '权限',
            render: () => (
                <CompactHoverSelect
                    $token={token}
                    prefix={<SafetyOutlined style={{ fontSize: 12, opacity: 0.55, color: permissionModeColor }} />}
                    value={permissionMode}
                    onChange={v => setPermissionMode(v as PermissionMode)}
                    disabled={inputDisabled}
                    options={permissionSelectOptions}
                    style={{ color: permissionModeColor }}
                />
            ),
        },
    ], [
        token, inputDisabled, agent, model, effort, permissionMode,
        permissionModeColor, permissionSelectOptions, modelSelectOptions,
        handleAttach, handleModelSelect, handleModelEffortSelect, hasFinePointer,
        effortPopoverModel,
    ])

    // ============ Sender header ============
    const headerNodes = [
        showGhostHint && slash.activeCommand && (
            <div key="hint" style={{ padding: '4px 12px', fontSize: 12, color: token.colorTextTertiary }}>
                {slash.activeCommand.hint}
            </div>
        ),
        hasAttachments && (
            <AttachmentList
                key="attachments"
                attachments={attachments}
                onRemove={handleRemoveAttachment}
            />
        ),
    ].filter(Boolean)

    // ============ 提交按钮渲染 ============
    const renderSubmitButton = useCallback((_oriNode: React.ReactNode) => {
        return (
            <Button
                type="primary"
                size="small"
                loading={isPending}
                disabled={!gatePassed || isPending}
                onClick={() => handleSubmit()}
                style={{ borderRadius: token.borderRadiusSM, fontSize: 12 }}
            >
                {submitLabel}
            </Button>
        )
    }, [gatePassed, isPending, submitLabel, handleSubmit, token.borderRadiusSM])

    // ============ 加载中 ============
    if (isLoadingMachines) {
        return (
            <PageContainer>
                <Spin size="large" />
            </PageContainer>
        )
    }

    return (
        <PageContainer>
            <SidebarToggleWrapper>
                <SidebarToggle />
                <MobileMenuButton />
            </SidebarToggleWrapper>
            <ContentWrapper>
                <TitleBar $color={token.colorText}>
                    {title}
                </TitleBar>

                <div
                    ref={wrapperRef}
                    style={{ position: 'relative' }}
                    onDragEnter={inputDisabled ? undefined : handleDragEnter}
                    onDragOver={inputDisabled ? undefined : handleDragOver}
                    onDragLeave={inputDisabled ? undefined : handleDragLeave}
                    onDrop={inputDisabled ? undefined : handleDrop}
                >
                    <EnvironmentBar
                        machineOptions={machineOptions}
                        selectedMachineId={selectedMachineId}
                        onMachineChange={setSelectedMachineId}
                        directoryOptions={directoryOptions.map(d => ({
                            value: d.value,
                            label: d.label,
                        }))}
                        selectedDirectory={selectedDirectory}
                        onDirectoryChange={setSelectedDirectory}
                    />
                    <Sender
                        value={inputText}
                        onChange={handleChange}
                        onSubmit={() => {
                            // 有内容时才通过 Enter 提交
                            if (hasContent && gatePassed && !isPending) {
                                handleSubmit()
                            }
                        }}
                        submitType={hasFinePointer ? 'enter' : 'shiftEnter'}
                        placeholder="随心输入..."
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        loading={isPending}
                        disabled={inputDisabled}
                        onKeyDown={handleKeyDown}
                        onPaste={inputDisabled ? undefined : handlePaste}
                        header={headerNodes.length > 0 ? headerNodes : null}
                        style={{ background: 'var(--ant-color-bg-container)' }}
                        suffix={false}
                        footer={(oriNode) => (
                            <div>
                                {/* 配置 + 操作 */}
                                <div style={{
                                    padding: '6px 12px 8px',
                                    margin: '0 4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <ResponsiveActionBar
                                            items={row2Items}
                                            gap={4}
                                            suffix={renderSubmitButton(oriNode)}
                                        />
                                    </div>
                                </div>
                            </div>
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
                                const result = mention.selectItem(item, inputText)
                                if (result) {
                                    setInputText(result.text)
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
                                const result = slash.selectItem(item, inputText)
                                if (result) {
                                    setInputText(result.text)
                                    pendingCursorRef.current = result.cursorPos
                                }
                            }}
                            onHover={slash.setActiveIndex}
                        />
                    )}

                    {/* 拖拽上传覆盖层 */}
                    {isDragOver && (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                borderRadius: 'var(--ant-border-radius)',
                                zIndex: 20,
                                background: `color-mix(in srgb, ${token.colorBgContainer} 85%, transparent)`,
                                backdropFilter: 'blur(2px)',
                                border: `2px dashed ${token.colorPrimary}`,
                                pointerEvents: 'none',
                            }}
                        >
                            <InboxOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
                            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                                拖拽文件到此处上传
                            </span>
                        </div>
                    )}
                </div>
            </ContentWrapper>
        </PageContainer>
    )
}
