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
 * remote 模式二次确认状态机（ticket-23 从 ink useSwitchControls hook 抽出）。
 *
 * 语义与原 hook 逐条对齐：
 * - Ctrl-C：无 onExit 时转发 SIGINT 给本进程；有则二次确认后执行
 * - space：有 onSwitch 才构成切换键，二次确认后执行；无 onSwitch 时按可打印字符处理
 * - Kitty key-release 序列忽略（不误清待确认）
 * - 其他可打印字符清除待确认
 * - 待确认 15s（可配）超时自动清除；动作执行期间忽略后续按键
 */

import type { KeyIntent } from './switchKeys'

export type ConfirmationMode = 'exit' | 'switch' | null
export type ActionInProgress = 'exiting' | 'switching' | null

export interface SwitchConfirmationOptions {
    onExit?: () => void | Promise<void>
    onSwitch?: () => void | Promise<void>
    /** 待确认超时（默认 15s） */
    confirmationTimeoutMs?: number
}

export interface SwitchConfirmationState {
    confirmationMode: ConfirmationMode
    actionInProgress: ActionInProgress
}

export interface SwitchConfirmation {
    /** 喂入逐键意图（来自 interpretKeyChunk） */
    feed(intent: KeyIntent): void
    getState(): SwitchConfirmationState
    /** 清理定时器（卸载监听时调用；不触发回调） */
    dispose(): void
}

export function createSwitchConfirmation(opts: SwitchConfirmationOptions): SwitchConfirmation {
    const { onExit, onSwitch } = opts
    const confirmationTimeoutMs = opts.confirmationTimeoutMs ?? 15_000

    let confirmationMode: ConfirmationMode = null
    let actionInProgress: ActionInProgress = null
    let confirmationTimeout: ReturnType<typeof setTimeout> | null = null

    const resetConfirmation = (): void => {
        confirmationMode = null
        if (confirmationTimeout) {
            clearTimeout(confirmationTimeout)
            confirmationTimeout = null
        }
    }

    const setConfirmationWithTimeout = (mode: Exclude<ConfirmationMode, null>): void => {
        confirmationMode = mode
        if (confirmationTimeout) {
            clearTimeout(confirmationTimeout)
        }
        confirmationTimeout = setTimeout(() => {
            resetConfirmation()
        }, confirmationTimeoutMs)
    }

    const handleExit = (): void => {
        if (!onExit) {
            resetConfirmation()
            try {
                process.kill(process.pid, 'SIGINT')
            } catch {
                process.exit(130)
            }
            return
        }
        if (confirmationMode === 'exit') {
            resetConfirmation()
            actionInProgress = 'exiting'
            // 与原 hook 一致：先让确认 UI 有机会渲染再执行退出
            setTimeout(() => void onExit(), 100)
        } else {
            setConfirmationWithTimeout('exit')
        }
    }

    const handleSpace = (): void => {
        if (confirmationMode === 'switch') {
            resetConfirmation()
            actionInProgress = 'switching'
            setTimeout(() => void onSwitch?.(), 100)
        } else {
            setConfirmationWithTimeout('switch')
        }
    }

    return {
        feed(intent) {
            if (actionInProgress) return

            switch (intent.kind) {
                case 'exit':
                    handleExit()
                    return
                case 'space':
                    // 无 onSwitch 时 space 不构成切换键，按可打印字符处理（清确认）——
                    // 与原 hook 的 isSpace = Boolean(onSwitch) && … 语义一致
                    if (onSwitch) {
                        handleSpace()
                    } else if (confirmationMode) {
                        resetConfirmation()
                    }
                    return
                case 'key-release':
                case 'ignore':
                    return
                case 'printable':
                    if (confirmationMode) {
                        resetConfirmation()
                    }
                    return
            }
        },
        getState() {
            return { confirmationMode, actionInProgress }
        },
        dispose() {
            if (confirmationTimeout) {
                clearTimeout(confirmationTimeout)
                confirmationTimeout = null
            }
        },
    }
}
