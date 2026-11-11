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

import type { PanelSelectionResult } from './useChatInputBridge'

/**
 * composer 面板键位仲裁（ChatComposer / NewSessionPage 共用单源）。
 *
 * 迁移前两页各有一份 Tab/Enter 选择块与 Escape/Arrow 委托链（含同文件内
 * Tab/Enter 互为空副本）——面板键位语义一变要同步改四处。本 module 只负责
 * **面板消费**的部分；页面保留各自的额外键（ChatComposer 的 Ctrl+C 三态、
 * Escape 未消费后的 abort 兜底）。
 */

/** 面板键位仲裁需要的最小接口（useSlashCommandInteraction / useMentionInteraction 同形） */
export interface ComposerPanelKeySource {
    isOpen: boolean
    items: readonly unknown[]
    handleKeyDown(e: ComposerPanelKeyEvent): boolean
    selectCurrent(text: string): PanelSelectionResult | null
}

/** 键位事件的结构类型：React 合成事件与原生 KeyboardEvent 都满足 */
export interface ComposerPanelKeyEvent {
    key: string
    preventDefault(): void
    stopPropagation(): void
}

export interface ComposerPanelKeyContext {
    /** 当前文本（selectCurrent 按其定位触发词） */
    text: string
    slash: ComposerPanelKeySource
    mention: ComposerPanelKeySource
    /** 面板选中插回（ChatComposer 用 bridge.applySelection，null 自 no-op） */
    applySelection(result: PanelSelectionResult | null): void
}

/** Tab / Enter 在任一候选面板开着时是「选择当前项」，不是提交或默认补全 */
function selectFromOpenPanel(
    panels: readonly ComposerPanelKeySource[],
    ctx: ComposerPanelKeyContext,
): boolean {
    for (const panel of panels) {
        if (!panel.isOpen || panel.items.length === 0) continue
        ctx.applySelection(panel.selectCurrent(ctx.text))
        return true
    }
    return false
}

/**
 * 解析面板键位。返回 true = 事件已被面板消费（调用方应停止后续处理）。
 *
 * - Tab / Enter：slash 优先于 mention，命中即阻断默认行为并插回选中项
 * - Escape / ArrowUp / ArrowDown：委托两个面板的 handleKeyDown（slash 优先）
 * - 其他键：不碰面板，返回 false
 */
export function resolveComposerPanelKeyDown(
    e: ComposerPanelKeyEvent,
    ctx: ComposerPanelKeyContext,
): boolean {
    switch (e.key) {
        case 'Tab':
        case 'Enter': {
            const consumed = selectFromOpenPanel([ctx.slash, ctx.mention], ctx)
            if (consumed) {
                e.preventDefault()
                e.stopPropagation()
            }
            return consumed
        }
        case 'Escape':
        case 'ArrowUp':
        case 'ArrowDown':
            return ctx.slash.handleKeyDown(e) || ctx.mention.handleKeyDown(e)
        default:
            return false
    }
}
