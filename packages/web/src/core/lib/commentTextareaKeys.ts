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

import type { KeyboardEvent } from 'react'

type InputLike = HTMLInputElement | HTMLTextAreaElement

/**
 * 引用评论输入框的键位判定（QuoteCommentInput 浮层 / QuoteChipBar 列表卡编辑共用）：
 * **Enter 换行**（多行评论是合法输入）、**Ctrl/Cmd+Enter 提交**、Escape 取消。
 *
 * IME 规则单处承载：**组合中的 Enter 是确认候选词**（中文输入法必踩）——组合态下
 * 提交/取消键都不生效。消费方按返回值分发各自的提交/取消动作，键位判定不再两处各写一遍。
 *
 * @returns 'submit' | 'cancel' | null（其它按键不关心）
 */
export function commentTextareaAction(e: KeyboardEvent<InputLike>): 'submit' | 'cancel' | null {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) return 'submit'
    // Escape 同样豁免组合态：IME 组合中按 Esc 是「取消本次候选词」，不是取消评论编辑
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) return 'cancel'
    return null
}
