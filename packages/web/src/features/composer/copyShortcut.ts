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
 * Ctrl+C 快捷键的意图推导
 *
 * 注意：只拦截 Ctrl+C，不拦截 Cmd+C（metaKey）——Mac 上 Cmd+C 始终走系统原生复制，
 * 清空/中断交由 Ctrl+C 承担（与 Claude Code CLI 行为一致）。
 *
 * Sender 中按下 Ctrl+C 时，行为按优先级如下：
 * 1. 有选中文本（输入框内或页面任意位置） → 放行，走系统复制
 *    （否则用户选中文字想复制时会被清空输入框，破坏系统复制语义）
 * 2. 无选中 + 输入框有内容 → 清空输入
 * 3. 无选中 + 无内容 + 正在运行 → 中止当前 turn
 * 4. 否则 → 不处理（如空闲空内容）
 */

export type CopyShortcutAction = 'copy' | 'clear' | 'abort' | 'none'

export interface ResolveCopyShortcutInput {
    /** 当前是否有选中文本（window.getSelection 非空） */
    hasSelection: boolean
    /** 输入框当前文本 */
    text: string
    /** agent 是否正在运行一个 turn */
    running: boolean
    /** 是否存在可用的中止回调 */
    canAbort: boolean
    /** 中止请求是否进行中 */
    abortPending: boolean
}

/**
 * 推导 Ctrl+C / Cmd+C 的动作
 */
export function resolveCopyShortcut(input: ResolveCopyShortcutInput): CopyShortcutAction {
    const { hasSelection, text, running, canAbort, abortPending } = input

    // 有选中文本 → 优先走系统复制
    if (hasSelection) return 'copy'

    // 无选中 + 有内容 → 清空
    if (text.length > 0) return 'clear'

    // 无选中 + 无内容 + 运行中且可中止 → 中止
    if (running && canAbort && !abortPending) return 'abort'

    // 其余情况不处理
    return 'none'
}
