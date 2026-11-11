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

import { useCallback, useRef, type RefObject } from 'react'
import type { ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { normalizeLeadingChineseExclamation, normalizeLeadingChineseSlash } from '@/domain/command/composerInputNormalization'

/** ChatInput.onUpdate 的 ctx（与 ChatInputProps.onUpdate 定义一致，此处独立声明避免 ui 层类型回泄） */
interface TextInputCtx {
    text: string
    programmatic: boolean
    cursorOffset: number
}

/** 面板选中结果（mention/slash 的 selectItem/selectCurrent 契约；cursorPos null = 光标置尾） */
export interface PanelSelectionResult {
    text: string
    cursorPos: number | null
}

/** mention/slash hook 的桥接子集（只声明 bridge 用到的成员，两页 hook 形状一致） */
interface ChatInputBridgePanel {
    processChange: (text: string, cursorPos: number) => boolean
    close: () => void
}

interface UseChatInputBridgeParams {
    shellRef: RefObject<ChatInputHandle | null>
    slash: ChatInputBridgePanel
    mention: ChatInputBridgePanel
    /** 镜像同步：任何 onUpdate（**含 programmatic**——程序化写回也要跟镜像）先同步消费方 text 镜像 */
    onTextChange?: (text: string) => void
    /** 归一命中后的光标待恢复（消费方接 pendingCursorRef——归一写回后 DOM 光标需重定位） */
    onPendingCursor?: (offset: number) => void
    /** 用户主动键入标记（ChatComposer 的瞬态窗编辑哨兵 pausedEditRef） */
    onUserEdit?: () => void
}

/**
 * ChatInput（非受控编辑器）→ mention/slash (text, cursorPos) 模型的换算桥，
 * 聊天页与新会话页共用（composer 换底座票）。
 *
 * - onTextInput：归一管线（中文 IME 值级归一，写回走 setText=programmatic）+ 面板
 *   processChange。**programmatic onUpdate 提前返回**——受控 Sender 的 setState 写回
 *   不会回触发 onChange，非受控编辑器的写回必然触发 onUpdate，programmatic meta 就是
 *   这里的防线：插回的命令文本（如 `/cmd `）不得重新唤起面板
 * - applySelection：面板选中插回 = setText + setCursorOffset（两步都走程序化通道）
 */
export function useChatInputBridge({ shellRef, slash, mention, onTextChange, onPendingCursor, onUserEdit }: UseChatInputBridgeParams) {
    // 前值快照：归一器判定「本次变更是否为手输插入」需要对比前值（state 直读会 stale）
    const prevTextRef = useRef('')

    const onTextInput = useCallback((ctx: TextInputCtx) => {
        onUserEdit?.()
        // 镜像同步（含程序化写入——清空/回填/归一写回后镜像必须一致，canSend 等派生源）
        onTextChange?.(ctx.text)
        // 镜像前值全量跟进（含程序化写入），保证归一判定始终基于最新前值
        prevTextRef.current = ctx.text
        // 程序化写入（归一写回/选中插回/清空/草稿恢复）：跳过归一与面板检测（见上）
        if (ctx.programmatic) return

        let value = ctx.text
        // 中文 IME 输入归一管线（归一器单一来源 composerInputNormalization，循环逐器过）
        for (const normalize of [normalizeLeadingChineseExclamation, normalizeLeadingChineseSlash]) {
            const normalized = normalize(value, prevTextRef.current)
            if (normalized !== null) {
                onPendingCursor?.(ctx.cursorOffset)
                value = normalized
            }
        }
        // 归一命中：值级写回（programmatic 通道，onUpdate 会以 programmatic=true 再进来一次）
        if (value !== ctx.text) {
            prevTextRef.current = value
            shellRef.current?.setText(value)
        }

        // Slash 检测优先（内部同时处理 activeCommand 管理）
        if (slash.processChange(value, ctx.cursorOffset)) {
            mention.close()
            return
        }
        // Mention 检测
        if (mention.processChange(value, ctx.cursorOffset)) return
        mention.close()
    }, [shellRef, slash, mention, onTextChange, onPendingCursor, onUserEdit])

    const applySelection = useCallback((result: PanelSelectionResult | null) => {
        if (!result) return
        shellRef.current?.setText(result.text)
        // cursorPos null（契约：无精确落点）保持 setText 的默认置尾
        if (result.cursorPos != null) shellRef.current?.setCursorOffset(result.cursorPos)
    }, [shellRef])

    return { onTextInput, applySelection }
}
