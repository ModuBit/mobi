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

/**
 * 档③原地更新的锚点状态 store（generative-ui 票 04）。
 *
 * UI 块状态的外部承载：anchor（agent 正文 text block uuid，落库稳定）→ phase。
 * renderer 订阅自己 anchor 的槽位，把 `{$actionState: phase}` 并入
 * Renderer.initialState——react-lang 对 initialState 引用变化会重建 store，
 * 按钮文案随 `Switch($actionState, ...)` 派生翻转，markdown content 不变。
 *
 * 写入来源两个（幂等合成）：
 * - 点击即时翻转：renderer handleAction 发消息同时 set 'running'（不等扫描）
 * - ChatContainer 扫描：deriveOpenUITerminalStates 的结果批量 apply（刷新恢复
 *   也靠它——锚点随消息 meta 落库）
 */

import { create } from 'zustand'
import type { OpenUIActionPhase } from './actionState'

interface OpenUIActionStateStore {
    phases: Map<string, OpenUIActionPhase>
    /** 点击即时翻转（running）；终态值同样可写（扫描 apply 前的乐观口） */
    setPhase: (anchor: string, phase: OpenUIActionPhase) => void
    /** 扫描结果批量应用：只推进，不回退（done 后新 turn 未发起时不翻回 running） */
    applyDerived: (derived: Map<string, OpenUIActionPhase>) => void
    /** 会话清理（ChatContainer 卸载） */
    clearAll: () => void
}

export const useOpenUIActionStore = create<OpenUIActionStateStore>((set) => ({
    phases: new Map(),

    setPhase: (anchor, phase) =>
        set((s) => {
            if (s.phases.get(anchor) === phase) return s
            const next = new Map(s.phases)
            next.set(anchor, phase)
            return { phases: next }
        }),

    applyDerived: (derived) =>
        set((s) => {
            let changed = false
            const next = new Map(s.phases)
            for (const [anchor, phase] of derived) {
                if (next.get(anchor) === phase) continue
                next.set(anchor, phase)
                changed = true
            }
            return changed ? { phases: next } : s
        }),

    clearAll: () => set({ phases: new Map() }),
}))
