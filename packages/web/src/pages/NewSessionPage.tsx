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

import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react'
import { App, Button, Input, Tooltip, Select, Spin, Popover, Typography, Segmented, theme as antTheme } from 'antd'
import { Sender } from '@ant-design/x'
import { PlusOutlined, InboxOutlined, SafetyOutlined, RightOutlined, BranchesOutlined } from '@ant-design/icons'
import { Cpu } from 'lucide-react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { EffortLevel, PermissionMode } from '@mobi/shared'
import { EFFORT_LEVELS, EFFORT_LABELS, getPermissionModeOptionsForFlavor, getPermissionModeTone } from '@mobi/shared'
import { useMachines } from '@/core/data/hooks/queries/useMachines'
import { useSpawnSession, type SpawnInput } from '@/core/data/hooks/mutations/useSpawnSession'
import { useMachineDirectoryListing } from '@/components/session/useMachineDirectoryListing'
import { useRecentPaths } from '@/components/session/useRecentPaths'
import { useDirectoryCapabilities, type CapabilityTarget } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import { useDirectoryCommands } from '@/components/composer/useDirectoryCommands'
import { useAttachmentHandling } from '@/components/composer/useAttachmentHandling'
import { useMentionInteraction } from '@/components/composer/useMentionInteraction'
import { useSlashCommandInteraction } from '@/components/composer/useSlashCommandInteraction'
import { MentionDropdown } from '@/components/composer/MentionDropdown'
import { SlashCommandDropdown } from '@/components/composer/SlashCommandDropdown'
import { CommandHintBar } from '@/components/composer/CommandHintBar'
import { AttachmentList } from '@/components/composer/AttachmentItem'
import { ResponsiveActionBar, type ActionItem } from '@/components/composer/ResponsiveActionBar'
import { EnvironmentBar, extractProjectName } from '@/components/composer/EnvironmentBar'
import { useMobiApi } from '@/core/data/api/client'
import { type AgentType, type SessionType, CLAUDE_MODEL_FALLBACK } from '@/domain/session/types'
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
import { Icon } from '@/components/layout/Icon'
import { enableVConsole } from '@/core/lib/vconsole'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { useHasFinePointer } from '@/core/data/hooks/useMediaQuery'
import { normalizeDirectoryPath } from '@/core/utils/path'
import { makeClientSideId } from '@/core/lib/messages'
import { saveDraftText } from '@/core/lib/draftText'
import { getPermissionModeColor } from '@/components/composer/permissionModeColors'
import { shouldNotForwardDollarProps } from '@/core/lib/styledUtils'

const { useToken } = antTheme

/* ========== 常量 ========== */

const AGENT_OPTIONS: { value: AgentType; label: string; disabled?: boolean }[] = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'codex', label: 'Codex', disabled: true },
]

const SESSION_TYPE_OPTIONS: { value: SessionType; label: string }[] = [
    { value: 'simple', label: '普通' },
    { value: 'worktree', label: 'Worktree' },
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
    .${MODEL_DROPDOWN_CLASS} { left: 12px !important; right: 12px !important; max-width: calc(100vw - 24px) !important; }
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
    overflow-y: auto;

    /* 移动端键盘弹出时 viewport 缩小，允许滚动以保证输入框可达 */
    @supports (height: 100dvh) {
        @media (max-width: 640px) {
            align-items: flex-start;
            padding-top: max(10dvh, 48px);
            padding-bottom: 24px;
        }
    }
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
    font-size: 20px;
    font-weight: 500;
    color: ${props => props.$color};
    line-height: 1.4;
    margin-bottom: 24px;
`

const InputCard = styled.div`
    background: var(--ant-color-fill-tertiary);
    border: 1px solid var(--ant-color-border-secondary);
    border-radius: var(--ant-border-radius-lg, 12px);
    padding: 8px;

    /* Sender 在卡片内：白色背景 + 圆角，形成卡中卡 */
    && .ant-sender {
        border: none !important;
        box-shadow: none !important;
        border-radius: var(--ant-border-radius, 8px) !important;
        background: var(--ant-color-bg-container) !important;
    }
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
    // antd Select 的 classNames 是对象 | 函数联合；仅取对象式分支的 popup.root（函数式由 antd 内部消费）
    const extraPopupRoot = typeof propsClassNames === 'object' ? propsClassNames?.popup?.root : undefined
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
    const { t } = useTranslation()
    const { token } = useToken()
    const { message: messageApi } = App.useApp()
    const navigate = useNavigate()
    const { cwd: initialCwd } = useSearch({ strict: false }) as { cwd?: string }
    const api = useMobiApi()
    const hasFinePointer = useHasFinePointer()

    // 偏好配置（初始化从 localStorage 加载）
    const [agent, setAgent] = useState<AgentType>(() => loadPreferredAgent())
    const [model, setModel] = useState(() => loadPreferredModel())
    const [effort, setEffort] = useState<EffortLevel>(() => loadPreferredEffort())
    const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => loadPreferredPermissionMode())

    // 环境配置
    const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
    const [selectedDirectory, setSelectedDirectory] = useState('')
    const [sessionType, setSessionType] = useState<SessionType>('simple')
    const [worktreeName, setWorktreeName] = useState('')
    const [inputText, setInputText] = useState('')
    const [isPending, setIsPending] = useState(false)

    // 确认的目录：只有在用户明确选定（blur / 点击标签 / 初始化恢复）时才更新，
    // 用于 metadata 请求，避免输入过程中每字符触发
    const [confirmedDirectory, setConfirmedDirectory] = useState('')

    // 延迟加载 metadata：首次输入 '/' 时才请求，避免每输入一个目录字符就触发 metadata 请求
    const [metadataNeeded, setMetadataNeeded] = useState(false)

    // effort popover 状态
    const [effortPopoverModel, setEffortPopoverModel] = useState<string | null>(null)

    // 数据
    const { machines, isLoading: isLoadingMachines } = useMachines()
    const { spawnSession } = useSpawnSession()
    const { getRecentPaths, addRecentPath, removeRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()
    const activeMachines = machines.filter(m => m.active)

    // 当前选中机器的 homeDir
    const currentMachine = machines.find(m => m.id === selectedMachineId)
    const machineHomeDir = currentMachine?.metadata?.homeDir as string | undefined

    const { options: directoryOptions, isLoading: isDirectoryLoading } = useMachineDirectoryListing(
        selectedMachineId,
        selectedDirectory,
        machineHomeDir,
    )

    // 当前机器的最近路径
    const recentPaths = useMemo(() => getRecentPaths(selectedMachineId), [getRecentPaths, selectedMachineId])

    // 初始化机器选择（自动选择上次使用的机器，search param cwd 优先）
    useEffect(() => {
        if (activeMachines.length === 0) return
        if (selectedMachineId && activeMachines.find(m => m.id === selectedMachineId)) return
        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? activeMachines.find(m => m.id === lastUsed) : null
        if (foundLast) {
            setSelectedMachineId(foundLast.id)
            // search param cwd 优先于最近路径
            const dir = initialCwd || getRecentPaths(foundLast.id)[0]
            if (dir) {
                setSelectedDirectory(dir)
                setConfirmedDirectory(normalizeDirectoryPath(dir))
            }
        } else if (activeMachines[0]) {
            setSelectedMachineId(activeMachines[0].id)
            if (initialCwd) {
                setSelectedDirectory(initialCwd)
                setConfirmedDirectory(normalizeDirectoryPath(initialCwd))
            }
        }
    }, [activeMachines, selectedMachineId, getLastUsedMachineId, getRecentPaths, initialCwd])

    // search param cwd 变化时同步更新目录（响应式，非初始化场景）
    const cwdAppliedRef = useRef<string | undefined>(undefined)
    useEffect(() => {
        if (!initialCwd || cwdAppliedRef.current === initialCwd) return
        cwdAppliedRef.current = initialCwd
        setSelectedDirectory(initialCwd)
        setConfirmedDirectory(normalizeDirectoryPath(initialCwd))
        setMetadataNeeded(true)
    }, [initialCwd])

    // 能力目标：用 confirmedDirectory 避免输入过程触发 metadata
    const capTarget = useMemo<CapabilityTarget | null>(() => {
        return (selectedMachineId && confirmedDirectory)
            ? { kind: 'machine', machineId: selectedMachineId, cwd: confirmedDirectory }
            : null
    }, [selectedMachineId, confirmedDirectory])
    const capabilities = useDirectoryCapabilities(capTarget, { metadataEnabled: metadataNeeded })
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
    // 同步防重入标志（ref 即时生效，弥补 isPending setState 的异步窗口）(#13)
    const submittingRef = useRef(false)

    // Gate：是否已选好环境
    const gatePassed = !!(selectedMachineId && selectedDirectory)
    const hasContent = inputText.trim().length > 0
    const hasAttachments = attachments.length > 0
    const inputDisabled = !gatePassed

    // 动态标题：只在目录确认后更新，避免输入过程中频繁闪动
    const confirmedProjectName = confirmedDirectory ? extractProjectName(confirmedDirectory) : null
    const title = useMemo(() => {
        const templates = confirmedProjectName
            ? [
                (name: ReactNode) => <>我们想在 {name} 中构建什么？</>,
                (name: ReactNode) => <>来聊聊 {name} 吧</>,
                (name: ReactNode) => <>在 {name} 中开始新对话</>,
            ]
            : null
        if (!templates) {
            const fallbacks = ['你想做什么？', '有什么新想法？', '开始一段新对话']
            return fallbacks[Math.floor(Math.random() * fallbacks.length)]
        }
        const template = templates[Math.floor(Math.random() * templates.length)]
        return template(
            <span style={{
                textDecoration: 'underline',
                textDecorationColor: 'var(--ant-colorPrimary)',
                textUnderlineOffset: 4,
                textDecorationThickness: 2,
            }}>
                {confirmedProjectName}
            </span>,
        )
    }, [confirmedProjectName])

    // 连点品牌 Logo ≥5 次开启移动端调试面板（vConsole），隐蔽入口
    // 1.5s 内连续点击累计到 5 次即触发；超时重置计数
    const vconsoleTapRef = useRef({ count: 0, timer: null as ReturnType<typeof setTimeout> | null })
    const handleLogoTap = useCallback(() => {
        const state = vconsoleTapRef.current
        state.count += 1
        if (state.timer) clearTimeout(state.timer)
        if (state.count >= 5) {
            state.count = 0
            state.timer = null
            enableVConsole()
            return
        }
        state.timer = setTimeout(() => {
            state.count = 0
            state.timer = null
        }, 1500)
    }, [])

    // 随机 placeholder，与 session 详情页一致
    const placeholders = t('composer.placeholders', { returnObjects: true }) as string[]
    const placeholderIdx = useRef(Math.floor(Math.random() * placeholders.length))

    // 是否展示命令提示（hint 或 description 任一存在即展示）
    const showGhostHint = !!(slash.activeCommand?.hint || slash.activeCommand?.description)
        && inputText === `${slash.activeCommand!.value} `
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

        // 首次输入 '/' 时触发 metadata 加载（slash commands 需要）
        if (value.includes('/') && !metadataNeeded) {
            setMetadataNeeded(true)
        }

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
    }, [mention, slash, metadataNeeded])

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
        if (!selectedMachineId || !selectedDirectory || isPending || submittingRef.current) return
        // 附件上传中不允许提交（与 ChatComposer 一致），避免 uploading 附件被静默丢弃 (#1)
        if (attachmentsRef.current.some(a => a.status === 'uploading')) {
            messageApi.warning('附件上传中，请稍候')
            return
        }
        submittingRef.current = true
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
                sessionType,
                worktreeName: sessionType === 'worktree' ? (worktreeName.trim() || undefined) : undefined,
            }

            const result = await spawnSession(input)

            if (result.type !== 'success' || !result.sessionId) {
                messageApi.error(result.type === 'error' ? (result.message || '创建会话失败') : '创建会话失败')
                return
            }

            const sessionId = result.sessionId

            // 记录最近使用的机器和路径
            if (selectedMachineId) {
                setLastUsedMachineId(selectedMachineId)
                if (selectedDirectory.trim()) {
                    addRecentPath(selectedMachineId, selectedDirectory.trim())
                }
            }

            // 有内容时发送消息
            if (currentText || currentAttachments.length > 0) {
                // 拼接附件路径到消息文本（与 ChatComposer 一致）
                const completedAttachments = currentAttachments.filter(a => a.status === 'complete' && a.path)
                const attachmentPaths = completedAttachments.map(a => `@${a.path}`).join('\n')
                const finalText = attachmentPaths
                    ? `${currentText}\n${attachmentPaths}`
                    : currentText

                if (finalText) {
                    try {
                        // 生成客户端 localId 供 SSE 早到消息去重（与 useSendMessage 一致）(#14)
                        const localId = makeClientSideId('local')
                        await api.messages.send(sessionId, finalText, localId)
                    } catch {
                        // 发送失败：把内容暂存，详情页 sender 预填供用户重试 (#2)
                        // 会话已创建成功，仍导航到详情页（不留在 NewSessionPage）
                        saveDraftText(finalText)
                    }
                }
            }

            navigate({ to: '/sessions/$sessionId', params: { sessionId } })
        } catch (e) {
            messageApi.error(e instanceof Error ? e.message : '创建会话失败')
        } finally {
            submittingRef.current = false
            setIsPending(false)
        }
    }, [
        selectedMachineId, selectedDirectory, isPending,
        agent, model, effort, permissionMode, sessionType, worktreeName,
        spawnSession, navigate, messageApi, api.messages,
        setLastUsedMachineId, addRecentPath,
    ])

    // ============ 按钮状态 ============
    const canSubmit = gatePassed && !isPending && attachments.every(a => a.status !== 'uploading')

    // ============ model + effort 合并选择 ============
    const modelSelectOptions = useMemo(() => {
        return CLAUDE_MODEL_FALLBACK.map(opt => ({
            value: opt.value,
            label: opt.displayName,
            description: opt.description,
        }))
    }, [])

    const handleModelEffortSelect = useCallback((selectedModel: string, selectedEffort: EffortLevel) => {
        if (selectedModel !== model) setModel(selectedModel)
        if (selectedEffort !== effort) setEffort(selectedEffort)
    }, [model, effort])

    const handleModelSelect = useCallback((v: string) => {
        if (v !== model) setModel(v)
    }, [model])

    // permission mode 选项（带颜色 + 国际化，同 ChatComposer）
    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(),
        []
    )
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

    const permissionModeTone = permissionMode !== 'default' ? getPermissionModeTone(permissionMode) : null
    const permissionModeColor = getPermissionModeColor(token, permissionModeTone) ?? undefined

    // ============ ActionItems ============

    // Sender footer（内部）：attach + permission + model（同 ChatComposer）
    const footerItems: ActionItem[] = useMemo(() => [
        // 附件按钮
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
                        disabled={inputDisabled}
                        style={ACTION_BUTTON_STYLE}
                    />
                </Tooltip>
            ),
        },
        // 权限模式
        {
            key: 'permission',
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
        // Model + Effort 选择
        {
            key: 'model',
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
    ], [
        t, token, inputDisabled, effort, model, permissionMode,
        permissionModeColor, permissionSelectOptions, modelSelectOptions,
        handleAttach, handleModelSelect, handleModelEffortSelect, hasFinePointer,
        effortPopoverModel,
    ])

    // SubBar（Sender 下方抽屉）：次要配置项
    const subBarItems: ActionItem[] = useMemo(() => [
        // Agent 选择（Codex disabled）
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
                    options={AGENT_OPTIONS.map(a => ({ value: a.value, label: a.label, disabled: a.disabled }))}
                />
            ),
        },
        // 会话类型：内联 Segmented
        {
            key: 'sessionType',
            label: t('newSession.sessionType'),
            render: () => (
                <Segmented
                    value={sessionType}
                    onChange={v => setSessionType(v as SessionType)}
                    options={SESSION_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                    size="small"
                    disabled={inputDisabled}
                />
            ),
        },
    ], [token, t, inputDisabled, agent, sessionType])

    // ============ Sender header ============
    const headerNodes = [
        <CommandHintBar
            key="hint"
            visible={!!(showGhostHint && slash.activeCommand)}
            hint={slash.activeCommand?.hint}
            description={slash.activeCommand?.description}
        />,
        hasAttachments && (
            <AttachmentList
                key="attachments"
                attachments={attachments}
                onRemove={handleRemoveAttachment}
            />
        ),
    ].filter(Boolean)

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
                <TitleBar $color={token.colorTextSecondary}>
                    <span onClick={handleLogoTap} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 8 }}>
                        <Icon style={{ width: 24, height: 24, color: 'var(--ant-colorPrimary)' }} />
                    </span>
                    {title}
                </TitleBar>

                <InputCard>
                <div
                    ref={wrapperRef}
                    style={{ position: 'relative' }}
                    onDragEnter={inputDisabled ? undefined : handleDragEnter}
                    onDragOver={inputDisabled ? undefined : handleDragOver}
                    onDragLeave={inputDisabled ? undefined : handleDragLeave}
                    onDrop={inputDisabled ? undefined : handleDrop}
                >
                    <EnvironmentBar
                        machines={machines}
                        isLoading={isLoadingMachines}
                        selectedMachineId={selectedMachineId}
                        onMachineChange={setSelectedMachineId}
                        directoryOptions={directoryOptions}
                        isDirectoryLoading={isDirectoryLoading}
                        selectedDirectory={selectedDirectory}
                        onDirectoryChange={setSelectedDirectory}
                        onDirectoryConfirm={(dir) => setConfirmedDirectory(normalizeDirectoryPath(dir))}
                        recentPaths={recentPaths}
                        machineHomeDir={machineHomeDir}
                        onRemoveRecentPath={selectedMachineId
                            ? (path) => removeRecentPath(selectedMachineId, path)
                            : undefined}
                        disabled={false}
                    />
                    {/* Sender + Dropdowns：position: relative 使下拉定位于 Sender 上方 */}
                    <div style={{ position: 'relative' }}>
                    <Sender
                        value={inputText}
                        onChange={handleChange}
                        onSubmit={() => {
                            // dropdown 打开时 Enter 是选择，不是提交
                            if (slash.isOpen || mention.isOpen) return
                            if (hasContent && canSubmit) handleSubmit()
                        }}
                        submitType={hasFinePointer ? 'enter' : 'shiftEnter'}
                        placeholder={t(`composer.placeholders.${placeholderIdx.current}`)}
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        loading={isPending}
                        disabled={inputDisabled}
                        onKeyDown={handleKeyDown}
                        onPaste={inputDisabled ? undefined : handlePaste}
                        header={headerNodes.length > 0 ? headerNodes : null}
                        style={{
                            position: 'relative',
                            zIndex: 1,
                        }}
                        suffix={false}
                        footer={(_oriNode, { components: { SendButton } }) => (
                            <ResponsiveActionBar
                                items={footerItems}
                                gap={4}
                                suffix={
                                    hasContent ? (
                                        <SendButton disabled={!canSubmit} />
                                    ) : (
                                        <SendButton
                                            disabled={!canSubmit}
                                            icon={<PlusOutlined />}
                                            onClick={() => { if (canSubmit) handleSubmit() }}
                                        />
                                    )
                                }
                            />
                        )}
                    />

                    {/* SubBar：配置抽屉，从 Sender 底部滑出 */}
                    <div style={{
                        padding: '6px 6px 4px',
                        position: 'relative',
                        zIndex: 0,
                    }}>
                        <ResponsiveActionBar
                            items={subBarItems}
                            gap={4}
                        />
                    </div>

                    {/* Worktree 名称输入：独立行，不参与响应式折叠，确保用户可见 */}
                    <div style={{
                        display: 'grid',
                        gridTemplateRows: sessionType === 'worktree' ? '1fr' : '0fr',
                        transition: 'grid-template-rows 0.2s ease',
                    }}>
                        <div style={{ overflow: 'hidden' }}>
                            <div style={{ padding: '0 6px 4px' }}>
                                <Input
                                    size="small"
                                    prefix={<BranchesOutlined style={{ fontSize: 12, opacity: 0.55 }} />}
                                    placeholder={t('newSession.worktreeNamePlaceholder')}
                                    value={worktreeName}
                                    onChange={e => setWorktreeName(e.target.value)}
                                    disabled={inputDisabled}
                                    style={{ fontSize: 12 }}
                                    allowClear
                                />
                            </div>
                        </div>
                    </div>

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
                    </div>

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
                </InputCard>
            </ContentWrapper>
        </PageContainer>
    )
}
