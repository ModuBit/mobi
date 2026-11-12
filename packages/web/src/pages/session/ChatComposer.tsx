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

import { useState, useCallback, useMemo, useRef, useEffect, useImperativeHandle, lazy, Suspense, type Ref } from 'react'
import styled from '@emotion/styled'
import { theme, message } from 'antd'
import { SwapOutlined, InboxOutlined } from '@ant-design/icons'
import { Button } from '@/ui/base/interactive/button/Button'
import { ChatInput, type ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { useTranslation } from 'react-i18next'
import type { AgentState, ContextUsage, EffortLevel, FastModeState, GoalStatus, PermissionMode, Session, StopKind } from '@mobi/shared'
import { DEFAULT_EFFORT, getPermissionModeOptionsForFlavor } from '@mobi/shared'
import {
    isSegmentEmpty,
    QUOTE_MAX_COUNT,
    type ComposerQuoteRef,
    type ComposerSegments,
    type PendingQuoteRef,
} from '@/domain/chat/composerSegments'
import { fileRefToPlaceholderAttachment } from '@/core/lib/fileAttachments'
import { fileRefContext } from '@/core/utils/fileUrl'
import { AttachmentList } from '@/features/composer/attachmentItem'
import { AttachPanel } from '@/features/composer/AttachPanel'
import {
    ChatInputQuoteNode,
    extractQuotesFromEditorStateJSON,
} from '@/ui/shared/chat-input-quote'
import { composerCard } from '@/features/composer/composerSurface.styles'
import { ComposerInfoPanel } from '@/pages/session/ComposerInfoPanel'
import { resolveCopyShortcut } from '@/features/composer/copyShortcut'
import { resolveComposerPanelKeyDown } from '@/features/composer/composerPanelKeys'
import { resolveComposerSubmit } from '@/features/composer/resolveComposerSubmit'
import { ModelSettingsSelect } from '@/features/composer/ModelSettingsSelect'
import { GoalRow } from '@/ui/shared/GoalRow'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { useMobiApi } from '@/core/data/api/client'
import { consumeDraftText } from '@/core/lib/draftText'
import { locateQuotedMessage } from '@/core/lib/quoteLocate'
import { mergeDraftText, getDraft } from '@/core/lib/composerDrafts'
import { useComposerDraft } from '@/features/composer/useComposerDraft'
import { useComposerScaffold } from '@/features/composer/useComposerScaffold'
import type { CapabilityTarget } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import { useSDKMetadata } from '@/core/data/hooks/queries/useSDKMetadata'
import { MentionDropdown } from '@/features/composer/MentionDropdown'
import { SlashCommandDropdown } from '@/features/composer/SlashCommandDropdown'
import { CommandHintBar } from '@/features/composer/CommandHintBar'
import { ResponsiveActionBar, type ActionItem } from '@/features/composer/ResponsiveActionBar'
import { ToolStrip } from '@/features/composer/ToolStrip'
import { ActivateCover } from '@/ui/shared/ActivateCover'
import { buildPermissionModeHoverOptions } from '@/features/composer/permissionModeOption'
import { CompactHoverSelect } from '@/features/composer/CompactHoverSelect'
import { OutputStyleSwitch } from '@/features/composer/OutputStyleSwitch'
import { SubmitButton } from '@/features/composer/SubmitButton'
import { ContextRing } from '@/ui/shared/ContextRing'
import { resolveSubmitButtonState } from '@/features/composer/submitButtonState'
import { resolveSenderDisabled } from '@/features/composer/senderDisabled'
import { useHasFinePointer, useIsMobile } from '@/core/data/hooks/useMediaQuery'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { usePromptSuggestion, usePromptSuggestionStore } from '@/core/data/stores/promptSuggestionStore'
import { SuggestionChip } from '@/features/composer/SuggestionChip'
import { useSketchSession } from '@/features/composer/useSketchSession'

// 画板载体懒加载：excalidraw 重依赖只进画板异步 chunk，不进主 bundle
const SketchDrawer = lazy(() => import('@/features/sketchpad/SketchDrawer').then(m => ({ default: m.SketchDrawer })))

/** 载体（气泡编辑入口等父组件）可命令式调用的 composer 手柄（React 19 ref-as-prop） */
export interface ChatComposerHandle {
    /** 打开画板：空白画布新建（完成后产物落回 composer 附件，spec D4） */
    openSketch: () => void
    /** 气泡草图重编辑：经服务端 path 异步取数回填画板（取数/失败语义在 useSketchSession） */
    openBubbleSketch: (path: string) => void
    /** composer 当前引用条数（选区判定器的环境状态；事件时读，无需响应式） */
    getQuoteCount: () => number
    /**
     * 灌入一条引用（消息列表选区动作 → composer），返回落位的条目（uid 供评论浮层寻址、
     * comment 供续编辑回填）；同片段重复添加返回已有条目；达上限返回 null（防御，
     * 判定器 limitReached 一般先拦）
     */
    addQuote: (quote: PendingQuoteRef) => ComposerQuoteRef | null
    /** 补充/清空某条引用的评论（「添加到对话」即落条目，评论只是后续补充） */
    updateQuoteComment: (uid: string, comment: string | undefined) => void
}


interface ChatComposerProps {
    sessionId: string
    disabled?: boolean
    sending?: boolean
    permissionMode?: PermissionMode
    model?: string | null
    active?: boolean
    allowSendWhenInactive?: boolean
    running?: boolean
    /** /clear 进行中：output style 切换器禁用（切换同为 /clear 语义，避免并发清空） */
    clearInProgress?: boolean
    /** 当前 output style（runtimeState.outputStyle keep-alive 为权威，sdkMetadata 仅老会话兜底；undefined → default） */
    outputStyle?: string | null
    /** init 上报的可选 style 名（sdkMetadata.availableOutputStyles），透传 OutputStyleSwitch 追加非内置下拉项 */
    availableOutputStyles?: string[]
    agentState?: AgentState | null
    metadata?: SessionMetadataSummary | null
    agentFlavor?: string | null
    mode?: Session['mode']
    workingDir?: string
    extraLeftButtons?: React.ReactNode
    extraItems?: ActionItem[]
    effort?: EffortLevel
    onEffortChange?: (effort: EffortLevel) => void
    /** 快速模式开关（运行时切换走会话配置 RPC） */
    fastMode?: boolean
    /** 快速模式运行态（会话元数据 fastModeState）：cooldown 时面板如实显示冷却 */
    fastModeState?: FastModeState | null
    onFastModeChange?: (enabled: boolean) => void
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string | null) => void
    /** 发送回调：入参为当前输入的完整分段（文本 + 附件双桶 + 引用），wire 格式由 useSendMessage 序列化 */
    onSend: (segments: ComposerSegments) => void
    /** 引用条目点击定位（跳转前停贴底跟随的收口在 ChatContainer；缺省直连 locateQuotedMessage） */
    onQuoteLocate?: (messageId: string) => void
    /** 中止会话：入参为停止档位（键盘快捷键路径固定 'turn'；按钮长短按见 SubmitButton） */
    onAbort?: (stopKind: StopKind) => void
    abortPending?: boolean
    onActivate?: () => void
    activatePending?: boolean
    onSwitchToRemote?: () => void
    switchPending?: boolean
    /** 上下文用量（来自 session.runtimeState.contextUsage）；无值时不渲染水位圆环 */
    contextUsage?: ContextUsage | null
    /** 水位圆环 Popover 内的「立即压缩」（仅 ≥60% 有效上限时展示） */
    onCompact?: () => void
    /** 会话运行中：压缩按钮置灰 */
    compactDisabled?: boolean
    /** goal 状态（来自 session.runtimeState.goalStatus；无值时状态行不渲染） */
    goal?: GoalStatus | null
    /**
     * 外部结构化回填请求（rewind 收尾把锚点批分段灌回 sender 并聚焦；
     * 排队消息编辑经 composerBackfillStore 信箱由 ChatContainer 消费后也走此通道）：
     * nonce 单调递增触发应用，同 nonce 不重复；segments 全空时忽略
     */
    draftRequest?: { segments: ComposerSegments; nonce: number }
    /** React 19：气泡编辑入口经此打开画板（重编辑路径），见 ChatComposerHandle */
    ref?: Ref<ChatComposerHandle>
    /** PC 端画板浮层挂载层（聊天内容区全宽节点）：停靠/全屏共用，浮层 absolute 定位相对它；缺省挂 body 全屏兜底 */
    sketchLayerEl?: HTMLElement | null
    /** PC 端画板停靠几何（px，相对挂载层，见 SketchDrawerProps.dockMetrics） */
    sketchDockMetrics?: { top: number; bottom: number; left: number; right: number } | null
}

// Dock 容器：包裹整个 Composer 区域，和 BubbleList 形成视觉分隔。
// 白卡与圆钮样式来自 composerSurface.styles 共享片段（与新会话页 InputCard 同一套）
const ComposerDock = styled.div`
    /* 白卡容器（共享片段）：header 内容行 + 输入区 + 参数条共居同一白底圆角卡。
       margin 三档几何本页自管（空态 / 有内容层见下），共享片段只给白底与圆角 */
    ${composerCard}

    /* 空态：白卡上下不留垂直空隙（内容层存在时见下条覆盖）；水平只悬 8px（-8）
       而非共享片段的 -16——-16 里本有 8px 是「抵消 Dock 内衬」的部分，空态没有
       Dock 内衬可抵，照抄会把白卡推到贴死屏幕边（外层 16px 内衬 − 16px = 0 缝） */
    && .composer-card {
        margin: 0 -8px;
    }

    /* 背后有内容层（InfoPanel / GoalRow 渲染了非 null，⟺ 直接子元素不止 wrapper
       一个）才现身，且灰底只铺上方——内容层都在白卡上方（各管各的：上没内容上不铺，
       下方永远没有内容层，所以永不铺），白卡下缘直接落在页面底色上。对齐手绘稿：
       灰卡装着内容行、白卡悬挑在中间；空态时 Dock 若仍上灰底，只剩上下两条空圆角带
       ——比没有 Dock 更难看，此时白卡直接落在页面底色上，分层只靠底色差 + 圆角 */
    &&:not(:has(> :only-child)) {
        background: var(--ant-color-fill-quaternary);
        border-radius: var(--radius-panel) var(--radius-panel) 0 0;
        /* 下方不留内衬：有白卡 margin 8px + padding 8px 叠出的灰带会悬在卡片底下 */
        padding: 8px 8px 0;
    }

    &&:not(:has(> :only-child)) .composer-card {
        margin: 8px -16px 0;
    }

    /* SubBar 与白卡内容同轨：容器镜像白卡的水平悬挂量，再把 16px 内衬让给
       输入区/参数条那条内容轨（白卡外缘 ≠ 内容轨，按钮盒要落在内容轨上）。
       没有内容层时白卡只悬 8px，有内容层时 Dock 内衬 8 + 白卡 -16，两种几何
       分别镜像；不镜像的话参数条会随 InfoPanel/GoalRow 的出现横跳 8px。 */
    && .composer-subbar {
        margin-inline: -8px;
        padding: 6px 16px 4px;
    }

    &&:not(:has(> :only-child)) .composer-subbar {
        margin-inline: -16px;
    }

    /* bash 模式：橙色发光边框（输入 ! 空格 触发 wrapper 的 .bash-mode）。
       box-shadow 的 spread 模拟实色边框、blur 模拟外发光，不动 border-width 避免布局
       抖动；ChatInput 无内置 box-shadow，无需再打 !important 反向覆盖 */
    && .bash-mode .composer-card {
        box-shadow: 0 0 0 2px rgba(232, 112, 58, 0.6),
                    0 0 16px rgba(232, 112, 58, 0.25);
    }
`

// 紧凑 Select 与 dropdown 样式注入统一在 CompactHoverSelect.tsx（composer / output style 切换器共用）

// 预配置的紧凑 Select 已抽出为共享的 CompactHoverSelect.tsx（composer / output style 切换器共用）
// 模型设置面板（ModelSettingsSelect）在 features/composer/ModelSettingsSelect.tsx

/**
 * 聊天输入组件
 * 基于 ChatInput（TipTap 封装，ui/base/interactive/chat-input）+ mention/slash 桥接
 * （useChatInputBridge），支持多行输入、附件上传、@文件引用、/斜杠命令
 */
export function ChatComposer(props: ChatComposerProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const api = useMobiApi()
    const hasFinePointer = useHasFinePointer()
    const isMobile = useIsMobile()

    // goal 清理回调：供 GoalRow 行尾的 ClearStateButton 使用
    const handleClearGoal = useCallback(
        async (sid: string, fields: ClearRuntimeStateField[]) => {
            await api.sessions.clearRuntimeStateFields(sid, fields)
        },
        [api],
    )

    const {
        sessionId,
        disabled = false,
        sending = false,
        permissionMode = 'default',
        model = null,
        active = true,
        allowSendWhenInactive = false,
        running = false,
        clearInProgress = false,
        outputStyle = null,
        availableOutputStyles,
        agentState,
        metadata,
        agentFlavor,
        mode,
        workingDir,
        effort = DEFAULT_EFFORT,
        onEffortChange,
        fastMode,
        fastModeState,
        onFastModeChange,
        extraLeftButtons,
        extraItems,
        onPermissionModeChange,
        onModelChange,
        onSend,
        onQuoteLocate,
        onAbort,
        abortPending = false,
        onActivate,
        activatePending = false,
        onSwitchToRemote,
        switchPending = false,
        contextUsage,
        onCompact,
        compactDisabled = false,
        goal,
        draftRequest,
        ref,
        sketchLayerEl = null,
        sketchDockMetrics = null,
    } = props

    const [text, setText] = useState('')
    // 当前输入值快照（归一判定/提交取值/编辑器就绪对账的闭包需要最新值，state 直读会 stale）
    const textRef = useRef(text)
    textRef.current = text
    // shellRef：ChatInput 命令式通道（非受控编辑器是 source of truth，text state 只是镜像）
    const shellRef = useRef<ChatInputHandle | null>(null)
    const wrapperRef = useRef<HTMLDivElement>(null)

    // 待发送引用：source of truth = 编辑器文档（chip 节点即数据），quoteCount 只是镜像
    // （canSend 派生 / 空判定）；增删改走 ChatInputHandle 的引用方法。上限 QUOTE_MAX_COUNT
    // 是引用入口的前置契约（addQuoteToEditor 拦截），serialize 侧 slice 为底线
    const [quoteCount, setQuoteCount] = useState(0)
    const quoteCountRef = useRef(0)
    quoteCountRef.current = quoteCount
    // 编辑器 JSON 快照镜像（每次 onUpdate 刷新）：草稿保存发生在组件卸载清理阶段，
    // 此时 shellRef 已被 React 置 null，不能再回调句柄取快照
    const editorStateJsonRef = useRef<string | null>(null)

    // 引用注入编辑器（未就绪排队）：草稿恢复 / 旧格式 quotes 桶等程序通道共用——
    // immediatelyRender:false 下恢复可能早于编辑器就绪，排队到 onReady 一并插入
    const pendingQuotesRef = useRef<PendingQuoteRef[] | null>(null)
    // 结构化草稿同理：恢复的 rAF 早于编辑器就绪时先存这里，onReady 对账时再写入
    // （否则 setEditorStateJSON 因 shellRef 为 null 静默丢弃，只剩 text 降级文本）
    const pendingEditorStateRef = useRef<string | null>(null)
    // wire（Markdown）回填同理：编辑器未就绪时排队，onReady 后按 Markdown 解析写入——
    // 若退回 setText 纯文本通道，格式会变成字面 `**x**` 并在重发时被二次转义
    const pendingMarkdownRef = useRef<string | null>(null)
    const insertPendingQuotesIfReady = useCallback(() => {
        const shell = shellRef.current
        const pending = pendingQuotesRef.current
        if (!shell?.isReady() || !pending) return false
        pendingQuotesRef.current = null
        shell.insertQuotesAtEnd(pending)
        return true
    }, [])

    // 编辑器就绪对账：就绪前镜像可能已恢复草稿/跨页草稿、引用已排队——就绪后一次性
    // 写入编辑器（就绪后才发生的恢复走各写入点的双写，不经此）。
    // 结构化快照须在 setText 前取：setText 的 onUpdate 会把镜像刷成纯文本文档；
    // 快照同时是 dev StrictMode 二次挂载（新 editor 实例）重建 chip 的来源
    const handleShellReady = useCallback(() => {
        const snapshot = pendingEditorStateRef.current ?? editorStateJsonRef.current
        const pendingMarkdown = pendingMarkdownRef.current
        pendingMarkdownRef.current = null
        // 待回填的 Markdown 优先按富文本解析；纯文本镜像只作最后兜底
        if (pendingMarkdown != null) shellRef.current?.setMarkdown(pendingMarkdown)
        else if (textRef.current) shellRef.current?.setText(textRef.current)
        if (snapshot) shellRef.current?.setEditorStateJSON(snapshot)
        pendingEditorStateRef.current = null
        insertPendingQuotesIfReady()
    }, [insertPendingQuotesIfReady])

    // 镜像 + 编辑器双写单源：编辑器未就绪时写入为 no-op，由 onReady 对账兜底
    const setTextWithEditor = useCallback((v: string) => {
        setText(v)
        shellRef.current?.setText(v)
    }, [])
    // wire（Markdown）回填：未就绪时排队到 onReady；镜像同步跟进（canSend/草稿保存派生源）
    const setMarkdownWithEditor = useCallback((v: string) => {
        setText(v)
        const shell = shellRef.current
        if (shell?.isReady()) shell.setMarkdown(v)
        else pendingMarkdownRef.current = v
    }, [])
    // 旧格式草稿的引用桶恢复（无 uid）：排队到编辑器就绪后逐条插入末尾
    const restoreDraftQuotes = useCallback((qs: PendingQuoteRef[]) => {
        pendingQuotesRef.current = qs
        insertPendingQuotesIfReady()
    }, [insertPendingQuotesIfReady])

    // 设置草稿并聚焦：suggestion 采纳共用此实现
    const setDraft = useCallback((draftText: string) => {
        setTextWithEditor(draftText)
        shellRef.current?.focus()
    }, [setTextWithEditor])

    // rewind 收尾结构化回填请求体：经 ref 读最新值，下方 effect 只依赖 nonce——
    // 避免 draftRequest 对象引用变化重复触发（effect 与 applySegments 定义在同处，见 segmentBuckets 之后）
    const draftRequestRef = useRef(draftRequest)
    draftRequestRef.current = draftRequest

    // 跨页草稿（NewSessionPage 创建会话后发送失败时暂存）优先级最高：取出后落入当前 session 草稿，
    // 随后 useComposerDraft 的 rAF 恢复会从草稿库读到它 —— 天然一致，无需标志位协调 (#2)
    useEffect(() => {
        if (!sessionId) return
        const crossPageDraft = consumeDraftText()
        if (crossPageDraft) {
            // 跨页草稿存的是 wire（Markdown）：按富文本回填，不能走 setText 纯文本通道
            setMarkdownWithEditor(crossPageDraft)
            // 仅更新文本，保留该 session 既有的附件/引用草稿（避免空分段覆盖）。
            // 结构化快照随正文作废，但其中的 chip 先摘出来转入 quotes 桶——
            // 否则快照一删，引用与评论就彻底丢了
            const existing = getDraft(sessionId)
            const carriedQuotes = existing?.editorState
                ? extractQuotesFromEditorStateJSON(existing.editorState.json)
                : []
            mergeDraftText(sessionId, crossPageDraft, carriedQuotes)
        }
    }, [sessionId, setMarkdownWithEditor])

    // 构建目录能力目标，useMemo 保证引用稳定，避免下游 useEffect 无限循环
    const capTarget = useMemo<CapabilityTarget | null>(
        () => sessionId ? { kind: 'session', sessionId } : null,
        [sessionId],
    )

    // 失活覆盖谓词：会话失活/被归档（允许发送时除外）。单一命名，Sender 遮罩与
    // 控件禁用（controlsDisabled）共引——失活判据加条件只改这里
    const inactiveCover = !active && !allowSendWhenInactive
    // 控件禁用：失活时禁用输入与拖拽，并需重置拖拽计数避免覆盖层残留
    const controlsDisabled = disabled || inactiveCover

    // 瞬态窗编辑哨兵：输入区不再被瞬态闸 DOM-disable（焦点修复），rewind/压缩/
    // 清空进行中用户仍可键入——这段主动输入优先于完成回填（整体跳过 applySegments，
    // 保留窗口期的 text/引用/附件状态），否则会被回退后的分段静默覆写
    const pausedEditRef = useRef(false)
    const markUserEdit = useCallback(() => {
        if (disabled) pausedEditRef.current = true
    }, [disabled])

    // 装配骨架（与新会话页共用单源）：能力探测 / 目录命令 / 附件 / 面板 /
    // 编辑器桥接 / 粘贴桥 / 光标恢复 / 点外关闭 / 建议列表 ARIA / placeholder
    const {
        attachments: attachmentHandling,
        mention,
        slash,
        bridge,
        handlePasteNative,
        placeholder,
        showGhostHint,
    } = useComposerScaffold({
        capTarget,
        workingDir,
        text,
        wrapperRef,
        shellRef,
        onTextChange: setText,
        onUserEdit: markUserEdit,
        attachmentsDisabled: controlsDisabled,
        attachmentSessionId: sessionId,
    })
    const {
        attachments,
        setAttachments,
        isDragOver,
        handleAttach, handleRemoveAttachment,
        addSketchFile,
        handleDragEnter, handleDragOver, handleDragLeave, handleDrop,
        resetAttachments,
    } = attachmentHandling

    // ── 画板（入口按钮 / 附件卡重编辑 / 气泡重编辑落回，spec D3/D4/D5）──
    // 会话状态机（everOpened 门控 / 完成语义 / 回源守卫）收在 useSketchSession
    const resolveContext = useMemo(
        () => fileRefContext(sessionId, metadata),
        [sessionId, metadata?.path],
    )
    const sketchSession = useSketchSession({
        addSketchFile,
        removeAttachment: handleRemoveAttachment,
        notifyLoadFailed: () => message.warning(t('sketch.loadFailed')),
        resolveContext,
    })
    const { session: sketch, everOpened: sketchEverOpened, openNew: handleOpenSketch, openForAttachment: handleSketchEditAttachment, complete: handleSketchComplete, cancel: handleSketchCancel } = sketchSession

    // 气泡重编辑入口：完成后产物同样落回 composer 附件（历史不可变）。
    // getQuoteCount/addQuote/updateQuoteComment：消息列表选区引用动作的手柄通道
    //（引用是即时动作，「添加到对话」即落条目，后续评论只是补充，无需信箱防重放）。
    // source of truth = 编辑器文档：增删改经 ChatInputHandle 的引用方法（业务层不见 TipTap），
    // quoteCount 镜像随 onUpdate 更新
    const addQuote = useCallback((quote: PendingQuoteRef): ComposerQuoteRef | null => (
        shellRef.current?.addQuote(quote) ?? null
    ), [])
    // 评论补充入口（「添加到对话」即落条目，评论浮层保存/清空都走这里；undefined = 清空）
    const updateQuoteComment = useCallback((uid: string, comment: string | undefined) => {
        shellRef.current?.updateQuoteComment(uid, comment)
    }, [])
    useImperativeHandle(ref, () => ({
        openSketch: handleOpenSketch,
        openBubbleSketch: sketchSession.openFromBubble,
        getQuoteCount: () => quoteCountRef.current,
        addQuote,
        updateQuoteComment,
    }), [handleOpenSketch, sketchSession.openFromBubble, addQuote, updateQuoteComment])

    // 结构化回填（排队消息编辑 / rewind 收尾共用）：text + 附件双桶（占位附件还原，
    // 不再上传，MIME 由扩展名兜底重 derive）+ 引用 chip 一并恢复并聚焦。
    // wire 回填数据无 uid——chip 重建走 insertQuotesAtEnd（内部 withQuoteUid 生成）
    const applySegments = useCallback((segments: ComposerSegments) => {
        const refs = [...segments.files, ...segments.images]
        // segments.text 是发送时的 wire（Markdown）：按 Markdown 回填才能无损 round-trip
        setMarkdownWithEditor(segments.text)
        setAttachments(refs.map(fileRefToPlaceholderAttachment))
        const quotesToRestore = segments.quotes.slice(0, QUOTE_MAX_COUNT)
        if (quotesToRestore.length > 0) restoreDraftQuotes(quotesToRestore)
        shellRef.current?.focus()
    }, [setAttachments, setMarkdownWithEditor, restoreDraftQuotes])

    // 回填应用门控：nonce 单调递增触发一次；空分段静默跳过
    // （数据异常无从还原时不清空用户当前草稿）
    const draftNonce = draftRequest?.nonce
    useEffect(() => {
        if (draftNonce == null) return
        const req = draftRequestRef.current
        if (req && !isSegmentEmpty(req.segments) && !pausedEditRef.current) applySegments(req.segments)
        pausedEditRef.current = false
    }, [draftNonce, applySegments])

    // per-session 草稿生命周期：挂载恢复、切走保存（依赖上面的 text/attachments/setters）
    // 草稿读回的 quotes 桶（旧格式，无 editorState）无 uid（持久化不存条目身份）→
    // 逐条插入编辑器末尾（withQuoteUid 生成）；新格式草稿由 editorState 整体恢复
    // （useComposerDraft 内部：editorState 存在时跳过 quotes 桶，避免 chip 双份）
    // 草稿保存时的结构化快照（含引用 chip 节点）：空态返回 null——isPersistedEmpty 以
    // 「editorState 存在」判定结构化内容非空（chip-only 草稿靠它存活，纯空态不落空文档）
    const getEditorState = useCallback(() => {
        // 纯空白（空格/换行）不算内容：否则空草稿也会带出 editorState，绕开
        // isPersistedEmpty 的清理并挤占 MAX_DRAFTS 名额；chip-only 草稿靠 quoteCount 存活
        if (!textRef.current.trim() && quoteCountRef.current === 0) return null
        return editorStateJsonRef.current
    }, [])
    // 结构化恢复：编辑器程序化写入（解析失败静默 no-op，此前 setText 的文本兜底已生效）；
    // 编辑器就绪前（shellRef 已挂但 editor 实例未创建，immediateRender:false）先排队到 onReady
    const applyEditorState = useCallback((json: string) => {
        const shell = shellRef.current
        if (shell?.isReady()) shell.setEditorStateJSON(json)
        else pendingEditorStateRef.current = json
    }, [])
    useComposerDraft(
        sessionId,
        { text, attachments, getEditorState },
        { setText: setTextWithEditor, setAttachments, setQuotes: restoreDraftQuotes, applyEditorState },
    )

    // SDK 元数据（模型列表等）
    const { data: sdkMetadata } = useSDKMetadata(sessionId ?? null)

    const trimmed = text.trim()
    const hasText = trimmed.length > 0
    const hasAttachments = attachments.length > 0
    const hasQuotes = quoteCount > 0
    // 有 pending 权限请求时禁用发送
    const hasPendingPermission = Boolean(agentState?.requests && Object.keys(agentState.requests).length > 0)
    // 注意：running 时不禁用发送——运行中发送的消息会进入排队悬浮条（queued），
    // 等当前 turn 结束由 gated pump 喂给 agent。abort 走独立按钮/Ctrl+C，与此独立。
    // 空判定同时看 text / 附件 / 引用，对齐 daemon「message requires text or attachments」语义
    const canSend = (hasText || hasAttachments || hasQuotes) && !controlsDisabled && !sending && !hasPendingPermission
    // 合并按钮状态：canSend 时展示发送（含 running 中有内容的特殊情况），否则 running/sending 中展示停止
    const submitButtonState = resolveSubmitButtonState({
        canSend,
        running,
        sending,
        abortPending,
    })
    const hasSubBar = !!extraItems?.length || !!(extraLeftButtons && !extraItems)

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const showSettingsButton = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)

    // 权限模式选项：名称 + 描述双行（morph description 槽），tone 色随选项图标；
    // 触发器 iconOnly（收起态仅当前模式图标 + chevron），色不再依赖容器 tint
    const permissionModeIconOptions = useMemo(
        () => buildPermissionModeHoverOptions(t, token),
        [t, token],
    )

    // 键盘导航（ChatInput 转发原生 KeyboardEvent；返回 true = 已消费，拦下内置 Enter 提交判定）
    const handleKeyDown = useCallback((e: KeyboardEvent): boolean => {
        // Ctrl+C：只拦 Ctrl 不拦 Cmd（Mac 上 Cmd+C 走原生复制）。
        // 有选中文本 → 放行复制；无选中 + 有内容 → 清空；无选中 + 无内容 + running → abort
        if (e.key === 'c' && e.ctrlKey) {
            const selection = window.getSelection()
            const hasSelection = !!selection && selection.toString().length > 0
            const action = resolveCopyShortcut({
                hasSelection,
                text: textRef.current,
                running,
                canAbort: !!onAbort,
                abortPending: !!abortPending,
            })
            if (action === 'copy') return false
            if (action === 'clear') {
                e.preventDefault()
                shellRef.current?.clear()
                mention.close()
                slash.reset()
                return true
            } else if (action === 'abort') {
                e.preventDefault()
                onAbort?.('turn')
                return true
            }
            return false
        }

        // 面板键位（Tab/Enter 选择、Escape/Arrow 委托）：与 NewSessionPage 共用单源
        if (resolveComposerPanelKeyDown(e, { text: textRef.current, slash, mention, applySelection: bridge.applySelection })) {
            return true
        }

        // Escape：面板都未消费 → running 时 abort
        if (e.key === 'Escape' && running && onAbort && !abortPending) {
            e.preventDefault()
            onAbort('turn')
            return true
        }
        return false
    }, [running, onAbort, abortPending, mention, slash, bridge])

    const handleSubmit = useCallback(() => {
        // 正文用 getWireText 剥掉 chip 的降级文本：引用由 quote block 承载，
        // 正文重复 excerpt 会成为气泡可见的重复内容；引用从编辑器文档收集（chip 节点即数据）
        const shell = shellRef.current
        const ready = shell?.isReady() === true
        const resolution = resolveComposerSubmit({
            text: ready ? shell!.getWireText() : textRef.current,
            quotes: ready ? shell!.getQuotes() : [],
            attachments,
            panelOpen: mention.isOpen || slash.isOpen,
            enabled: canSend,
        })
        if (!resolution.ok) {
            // 上传中附件没有 path，进不了分段会被静默丢弃，故阻止发送并提示
            if (resolution.blocked === 'uploading') message.warning(t('composer.uploadPendingWarning'))
            return
        }

        onSend(resolution.segments)
        // 清空走编辑器程序化通道（onUpdate programmatic 回写镜像/引用计数归零）
        shellRef.current?.clear()
        resetAttachments()
        // 发新消息即消失: 清空当前建议(生命周期"每轮结束显示, 发送后消失")
        usePromptSuggestionStore.getState().clearSession(sessionId)
        // PC 发送后保持输入焦点（textarea 语义等价：清空后光标仍在原位）；触屏刻意不恢复
        //（虚拟键盘不收起，现状语义平移）
        if (hasFinePointer) shellRef.current?.focus()
    }, [canSend, onSend, mention.isOpen, slash.isOpen, attachments, t, resetAttachments, sessionId, hasFinePointer])

    const showLocalModeCover = active && mode === 'local'
    // 参数条按钮闸：控件禁用 + 本地模式遮罩（按钮不持有焦点，挂 DOM disabled 无失焦风险，
    // 与 senderDisabled doc 的「textarea 闸」语义不同级）
    const chromeDisabled = controlsDisabled || showLocalModeCover
    const isBashMode = text.startsWith('! ')

    // 引用 chip 节点（装配注入 ChatInput）：onLocate 装配时绑定，节点 options 是
    // editor 创建期快照——onQuoteLocate 属稳定回调（父组件传入），变化场景随重挂生效
    const quoteNodes = useMemo(
        () => [ChatInputQuoteNode.configure({ onLocate: onQuoteLocate ?? locateQuotedMessage })],
        // eslint 未启用 exhaustive-deps 规则，依赖显式列出即可
        [onQuoteLocate],
    )

    // 下一轮建议(SDK prompt_suggestion, 瞬时): 有值则渲染 chip, 无则省略
    const suggestion = usePromptSuggestion(sessionId)

    // Sender header 区域内容（可组合，多条可共存）
    const headerNodes = [
        <CommandHintBar
            key="hint"
            visible={!!(showGhostHint && slash.activeCommand)}
            hint={slash.activeCommand?.hint}
            description={slash.activeCommand?.description}
        />,
        suggestion && (
            <SuggestionChip
                key="suggestion"
                text={suggestion}
                hidden={hasText}  // 用户输入时丝滑隐藏, 清空 draft 重新显示(store 未清)
                onAccept={() => {
                    setDraft(suggestion)  // 回填草稿 + 聚焦
                    // 采纳后即消失(建议已消费, 防止重复采纳)
                    usePromptSuggestionStore.getState().clearSession(sessionId)
                }}
                onDismiss={() => usePromptSuggestionStore.getState().clearSession(sessionId)}
            />
        ),
        hasAttachments && (
            <AttachmentList
                key="attachments"
                attachments={attachments}
                onRemove={handleRemoveAttachment}
                onEditSketch={handleSketchEditAttachment}
                refCtx={resolveContext}
            />
        ),
    ].filter(Boolean)

    return (
        // composer 永远不贴左右边缘：统一 24px 侧边距。不依赖 CHAT_MAX_WIDTH 居中兜底——
        // 视口减去侧栏/面板不足 1200 时聊天列按 100% 宽渲染，无侧边距即贴边
        // （24px 内衬 − 白卡悬挑 8px = 任何视口宽度下与屏幕边保底 16px 缝，与新会话页
        // 的 16px 卡缘留白同一档；原先 16px 内衬只剩 8px 缝，贴着侧栏/窗口边）
        // 底衬 = safe-area 减去键盘 inset：键盘弹出（overlay 模式）时 inset 覆盖了 home
        // 指示条区域，safe-area 若照常生效会与 MainLayout 的 --kb-inset 叠出双缝——白卡
        // 直接落在键盘上沿，只保 12px 最小呼吸。无键盘时 inset=0，回落原值。
        // transition 只列 padding-bottom：--kb-inset 终值一跳后由浏览器插值
        // （时长/曲线取自 --kb-anim），JS 不逐帧
        // data-perf-region：dev-only layout-shift 归因观测器；位于 chat 区域内部，
        // 归因时内层标注优先（composer 内位移源归 composer 不归 chat）
        <div style={{
            padding: '0 24px max(12px, calc(env(safe-area-inset-bottom, 0px) - var(--kb-inset, 0px)))',
            transition: 'padding-bottom var(--kb-anim)',
        }} data-perf-region="composer">
            {/* Dock 的进退场（ComposerDock 的 :has(> :only-child)）依赖此处的结构契约：
                InfoPanel 与 goal 行空态必须渲染 null——直接子元素只剩 wrapper 一个时
                Dock 背后无内容层，整体退场；多出任何一个非 null 孩子即现身 */}
            <ComposerDock>
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
            />

            {goal ? (
                <GoalRow
                    goal={goal}
                    sessionId={sessionId}
                    onClear={handleClearGoal}
                />
            ) : null}

            <div
                ref={wrapperRef}
                className={isBashMode ? 'bash-mode' : undefined}
                style={{ position: 'relative' }}
                onDragEnter={controlsDisabled ? undefined : handleDragEnter}
                onDragOver={controlsDisabled ? undefined : handleDragOver}
                onDragLeave={controlsDisabled ? undefined : handleDragLeave}
                onDrop={controlsDisabled ? undefined : handleDrop}
            >
                {/* ChatInput + Dropdowns：position: relative 使下拉定位于输入卡上方 */}
                <div style={{ position: 'relative' }}>
                {/* 白卡容器：header 内容行 + 输入区 + 参数条共居同一白底圆角卡
                    （原 antd Sender 的 header/content/footer 白卡结构的平移） */}
                <div
                    className="composer-card"
                    style={hasSubBar ? { position: 'relative', zIndex: 1 } : undefined}
                >
                {/* 原 Sender header：可组合内容行（提示条/建议 chip/引用条/附件列表） */}
                {headerNodes.length > 0 && headerNodes}

                <ChatInput
                    ref={shellRef}
                    placeholder={isBashMode ? t('composer.bashPlaceholder') : placeholder}
                    submitKey={hasFinePointer ? 'enter' : 'shiftEnter'}
                    disabled={resolveSenderDisabled({ inactiveCover, localModeCover: showLocalModeCover })}
                    onUpdate={(ctx) => {
                        // quoteCount 镜像（canSend/空判定派生）+ 桥接（归一/面板检测）
                        setQuoteCount(ctx.extraNodeCount)
                        editorStateJsonRef.current = ctx.editorStateJSON
                        bridge.onTextInput(ctx)
                    }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePasteNative}
                    onSubmit={() => handleSubmit()}
                    onReady={handleShellReady}
                    extraNodes={quoteNodes}
                    aria-label={t('composer.inputLabel', '消息输入框')}
                />

                {/* 原 Sender footer → 参数条：+（附件）与 send 两端固定，中间可横向拖动滚动
                   （ResponsiveActionBar 的溢出收纳在参数条上退役，见 ToolStrip 组件注释） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 16px 12px' }}>
                    {/* 附件面板：文件/拍照（移动端）/画板聚合入口（Codex 风格富面板）——左端固定锚 */}
                    <AttachPanel
                        disabled={chromeDisabled || hasPendingPermission}
                        onAttach={handleAttach}
                        onSketch={() => handleOpenSketch()}
                    />
                    <ToolStrip
                        style={{ flex: 1, minWidth: 0 }}
                        items={[
                        // permissionmode
                        ...(showSettingsButton ? [{
                            key: 'permission',
                            content: (
                                <CompactHoverSelect
                                    label={t('composer.permissionMode')}
                                    iconOnly
                                    value={permissionMode ?? 'default'}
                                    onChange={v => onPermissionModeChange?.(v as PermissionMode)}
                                    disabled={chromeDisabled}
                                    options={permissionModeIconOptions}
                                />
                            ),
                        }] : []),
                        // 模型设置（模型 + 推理档位，面板形态同创建页）
                        ...(onModelChange ? [{
                            key: 'model',
                            content: (
                                <ModelSettingsSelect
                                    label={t('composer.model')}
                                    model={model ?? 'auto'}
                                    effort={effort ?? DEFAULT_EFFORT}
                                    models={sdkMetadata?.models}
                                    fastMode={fastMode}
                                    fastModeState={fastModeState ?? null}
                                    onModelChange={v => onModelChange(v)}
                                    onEffortChange={onEffortChange ? e => onEffortChange(e) : undefined}
                                    onFastModeChange={onFastModeChange}
                                    disabled={chromeDisabled}
                                />
                            ),
                        }] : []),
                        // output style 切换器（/clear 语义，运行中 / clear 进行中禁用）；排模型之后
                        {
                            key: 'outputStyle',
                            content: (
                                <OutputStyleSwitch
                                    sessionId={sessionId}
                                    outputStyle={outputStyle}
                                    availableStyles={availableOutputStyles}
                                    running={running}
                                    clearInProgress={clearInProgress}
                                    disabled={chromeDisabled}
                                />
                            ),
                        },
                        // 上下文水位圆环（仅 PC；移动端挂 ChatPane header，避免挤占底部空间）
                        ...(!isMobile && contextUsage ? [{
                            key: 'contextRing',
                            content: <ContextRing usage={contextUsage} onCompact={onCompact} compactDisabled={compactDisabled} />,
                        }] : []),
                    ]}
                    />
                    {showLocalModeCover ? null : (
                        <SubmitButton
                            state={submitButtonState}
                            onSubmit={() => handleSubmit()}
                            onAbort={onAbort}
                        />
                    )}
                </div>
                </div>

                {/* Sub Bar：Sender 下方次要操作，宽度不够时自动收起 */}
                {hasSubBar && (
                    <div
                        className="composer-subbar"
                        style={{ position: 'relative', zIndex: 0 }}
                    >
                        <ResponsiveActionBar
                            items={[
                                // file terminal
                                ...(extraItems ?? []),
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
                        query={mention.query}
                        onSelect={(item) => bridge.applySelection(mention.selectItem(item, text))}
                        onHover={mention.setActiveIndex}
                    />
                )}

                {/* slash command 下拉 */}
                {slash.isOpen && (
                    <SlashCommandDropdown
                        items={slash.items}
                        loading={slash.isLoading}
                        activeIndex={slash.activeIndex}
                        query={slash.filter}
                        onSelect={(item) => bridge.applySelection(slash.selectItem(item, text))}
                        onHover={slash.setActiveIndex}
                    />
                )}
                </div>

                {/* 未激活覆盖层 */}
                {inactiveCover && (
                    <ActivateCover
                        className="activate-cover-mask"
                        loading={activatePending}
                        onActivate={onActivate!}
                        borderRadius="var(--radius-panel)"
                    />
                )}

                {/* 本地模式覆盖层 */}
                {showLocalModeCover && (
                    <div
                        className="activate-cover-mask"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 56,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'var(--radius-panel)',
                            zIndex: 10,
                        }}
                    >
                        <Button
                            variant="primary"
                            loading={switchPending}
                            onClick={onSwitchToRemote}
                        >
                            <SwapOutlined /> {t('composer.switchToRemote')}
                        </Button>
                    </div>
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
                            borderRadius: 'var(--radius-panel)',
                            zIndex: 20,
                            background: `color-mix(in srgb, ${token.colorBgContainer} 85%, transparent)`,
                            backdropFilter: 'blur(2px)',
                            border: `2px dashed ${token.colorPrimary}`,
                            pointerEvents: 'none',
                        }}
                    >
                        <InboxOutlined style={{ fontSize: 28, color: token.colorPrimary }} />
                        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                            {t('composer.dropToUpload')}
                        </span>
                    </div>
                )}
            </div>
            </ComposerDock>

            {/* 画板载体：停靠/全屏共用单实例浮层（挂内容区全宽层）；sketchEverOpened 门控——
                React.lazy 首 render 即拉 excalidraw chunk，未开过画板不挂载 */}
            {sketchEverOpened && (
                <Suspense fallback={null}>
                    <SketchDrawer
                        open={sketch !== null}
                        onClose={handleSketchCancel}
                        onComplete={handleSketchComplete}
                        initialSketch={sketch?.initialSketch ?? null}
                        layerEl={sketchLayerEl}
                        dockMetrics={sketchDockMetrics}
                    />
                </Suspense>
            )}
        </div>
    )
}
