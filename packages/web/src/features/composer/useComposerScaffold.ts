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

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { useDirectoryCapabilities, type CapabilityTarget } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import { useDirectoryCommands } from './useDirectoryCommands'
import { useAttachmentHandling } from './useAttachmentHandling'
import { useMentionInteraction } from './useMentionInteraction'
import { useSlashCommandInteraction } from './useSlashCommandInteraction'
import { useSuggestionListAria } from './useSuggestionListAria'
import { useChatInputBridge, type TextInputCtx } from './useChatInputBridge'
import { MENTION_LISTBOX_ID } from './MentionDropdown'
import { SLASH_LISTBOX_ID } from './SlashCommandDropdown'

/**
 * composer 装配骨架（ChatComposer / NewSessionPage 共用单源）。
 *
 * 收口两页逐字重复的装配管线：能力探测 → 目录命令 → 附件管理 → mention/slash
 * 初始化 → 编辑器桥接（归一/面板检测）→ 粘贴桥 → 光标恢复 → 点外关闭 →
 * 建议列表 ARIA → placeholder → 命令提示。页面只声明差异（target / 行高 /
 * 提交 adapter / 画板等页面特有件），不再各自维护一份接线。
 *
 * 接口刻意保持「参数即差异声明」：新增管线项时改本 module 一处，两页同时生效。
 */

export interface UseComposerScaffoldParams {
    /** 能力目标：会话页 {kind:'session'}；新会话页 {kind:'host', cwd} */
    capTarget: CapabilityTarget | null
    /** @ 引用与 / 命令的工作目录 */
    workingDir: string | undefined
    /** placeholder 文案池大小（每次挂载随机取一个下标；文案由调用方 t(key) 渲染） */
    placeholderCount: number
    /** 当前文本镜像（showGhostHint 派生输入） */
    text: string
    /** 点外关闭与 ARIA 的容器 */
    wrapperRef: RefObject<HTMLDivElement | null>
    /** ChatInput 命令式通道 */
    shellRef: RefObject<ChatInputHandle | null>
    /** 文本镜像同步（onUpdate，含程序化写入） */
    onTextChange: (text: string) => void
    /** 用户主动键入标记（会话页瞬态窗哨兵；新会话页无） */
    onUserEdit?: () => void
    /** 附件上传禁用（会话页失活/禁用时） */
    attachmentsDisabled?: boolean
    /** 附件归属会话（新会话页传 undefined：上传走 working 目录上下文） */
    attachmentSessionId: string | undefined
    /** 能力探测选项（新会话页 metadataEnabled 门控） */
    capabilitiesOptions?: { metadataEnabled?: boolean }
}

export function useComposerScaffold(params: UseComposerScaffoldParams) {
    const {
        capTarget, workingDir, placeholderCount, text, wrapperRef, shellRef,
        onTextChange, onUserEdit, attachmentsDisabled, attachmentSessionId, capabilitiesOptions,
    } = params

    // 能力探测 → 目录命令（/ 面板数据源）
    const capabilities = useDirectoryCapabilities(capTarget, capabilitiesOptions)
    const { data: commandsData, isLoading: commandsLoading } = useDirectoryCommands(capabilities)

    // 附件管理（上传/粘贴/拖拽/移除）
    const attachments = useAttachmentHandling(attachmentSessionId, capabilities, attachmentsDisabled)

    // @ 文件引用 / / 斜杠命令交互
    const mention = useMentionInteraction({
        target: capTarget,
        searchFiles: capabilities.searchFiles,
        listDirectory: capabilities.listDirectory,
        workingDir,
    })
    const slash = useSlashCommandInteraction({ commandsData, commandsLoading, workingDir })

    // 编辑器 → 面板模型桥接（归一管线 + processChange + 选中插回）
    // 状态事件单出口：页面的「用户编辑哨兵」与「文本镜像」在此编排（顺序即语义）
    const handleEditorUpdate = useCallback((ctx: TextInputCtx) => {
        onUserEdit?.()
        onTextChange(ctx.text)
    }, [onTextChange, onUserEdit])
    const bridge = useChatInputBridge({
        shellRef,
        slash,
        mention,
        onUpdate: handleEditorUpdate,
    })

    // 粘贴桥接：handlePaste 只消费 clipboardData 与 preventDefault，与原生 ClipboardEvent
    // 运行时同构；返回 defaultPrevented 让 ChatInput 拦下已被消费的粘贴（文件/超阈值转附件），
    // 其余放行编辑器默认插入
    const { handlePaste } = attachments
    const handlePasteNative = useCallback((e: ClipboardEvent): boolean => {
        handlePaste(e as unknown as React.ClipboardEvent)
        return e.defaultPrevented
    }, [handlePaste])

    // 归一命中后的光标恢复已收进 useChatInputBridge（桥内部事务）

    // 点击面板外部关闭
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
    }, [mention.isOpen, slash.isOpen, mention, slash, wrapperRef])

    // 建议列表 ARIA（属性经 DOM 直写）
    useSuggestionListAria(
        wrapperRef,
        mention.isOpen
            ? { listId: MENTION_LISTBOX_ID, activeIndex: mention.activeIndex, count: mention.items.length }
            : slash.isOpen
                ? { listId: SLASH_LISTBOX_ID, activeIndex: slash.activeIndex, count: slash.items.length }
                : null,
    )

    // placeholder 下标：每次挂载随机一个（ref 初始化，与既有行为一致）
    const placeholderIndexRef = useRef(Math.floor(Math.random() * placeholderCount))

    // 命令提示：提示/描述任一存在 + 文本恰好是「命令 + 空格」且面板已关
    const activeCommand = slash.activeCommand
    const showGhostHint = !!(activeCommand?.hint || activeCommand?.description)
        && text === `${activeCommand!.value} `
        && !slash.isOpen

    return {
        capabilities,
        commandsData,
        commandsLoading,
        attachments,
        mention,
        slash,
        bridge,
        handlePasteNative,
        placeholderIndex: placeholderIndexRef.current,
        showGhostHint,
    }
}
