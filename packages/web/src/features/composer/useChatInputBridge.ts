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
import { normalizeLeadingChineseExclamation, normalizeLeadingChineseSlash } from '@/domain/command/composerInputNormalization'

/** ChatInput.onUpdate 的 ctx（与 ChatInputProps.onUpdate 定义一致，此处独立声明避免 ui 层类型回泄） */
export interface TextInputCtx {
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
    /** 编辑器每次更新（**含 programmatic**）的统一出口；消费方按 ctx.programmatic 自行分流 */
    onUpdate?: (ctx: TextInputCtx) => void
}

/**
 * ChatInput（非受控编辑器）→ mention/slash (text, cursorPos) 模型的换算桥，
 * 聊天页与新会话页共用（composer 换底座票）。
 *
 * - onTextInput：归一管线（中文 IME 值级归一，写回走 setText=programmatic）+ 面板
 *   processChange。**programmatic onUpdate 提前返回**——受控 Sender 的 setState 写回
 *   不会回触发 onChange，非受控编辑器的写回必然触发 onUpdate，programmatic meta 就是
 *   这里的防线：插回的命令文本（如 `/cmd `）不得重新唤起面板
 * - 归一命中后的光标重定位是桥内部事务（写回后 DOM 光标需恢复），不暴露给消费方
 * - applySelection：面板选中插回 = setText + setCursorOffset（两步都走程序化通道）
 */
export function useChatInputBridge({ shellRef, slash, mention, onUpdate }: UseChatInputBridgeParams) {
    // 前值快照：归一器判定「本次变更是否为手输插入」需要对比前值（state 直读会 stale）
    const prevTextRef = useRef('')
    // 归一命中后的待恢复光标（写回会以 programmatic onUpdate 再进来一次，恢复要等它之后）
    const pendingCursorRef = useRef<number | null>(null)

    const onTextInput = useCallback((ctx: TextInputCtx) => {
        // 统一出口（含程序化写入——清空/回填/归一写回后消费方镜像必须一致，canSend 等派生源）
        onUpdate?.(ctx)
        // 前值必须在跟进之前取出：归一器对比的是「本次值 vs 上一值」，
        // 先覆盖再比对会让两者恒等（顿号归一因此永不命中）
        const previousText = prevTextRef.current
        // 镜像前值全量跟进（含程序化写入），保证归一判定始终基于最新前值
        prevTextRef.current = ctx.text
        // 程序化写入（归一写回/选中插回/清空/草稿恢复）：跳过归一与面板检测（见上）
        if (ctx.programmatic) return

        let value = ctx.text
        // 中文 IME 输入归一管线（归一器单一来源 composerInputNormalization，循环逐器过）
        for (const normalize of [normalizeLeadingChineseExclamation, normalizeLeadingChineseSlash]) {
            const normalized = normalize(value, previousText)
            if (normalized !== null) {
                pendingCursorRef.current = ctx.cursorOffset
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
    }, [shellRef, slash, mention, onUpdate])

    // 归一命中后的光标恢复：写回触发的 programmatic onUpdate 已让消费方重渲染，此处补光标
    useEffect(() => {
        if (pendingCursorRef.current != null) {
            shellRef.current?.setCursorOffset(pendingCursorRef.current)
            shellRef.current?.focus()
            pendingCursorRef.current = null
        }
    })

    const applySelection = useCallback((result: PanelSelectionResult | null) => {
        if (!result) return
        shellRef.current?.setText(result.text)
        // cursorPos null（契约：无精确落点）保持 setText 的默认置尾
        if (result.cursorPos != null) shellRef.current?.setCursorOffset(result.cursorPos)
    }, [shellRef])

    return { onTextInput, applySelection }
}
