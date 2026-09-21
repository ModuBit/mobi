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

/**
 * 引用评论 textarea 的键位判定（QuoteCommentInput 浮层 / QuoteChipBar 列表卡编辑共用）：
 * Enter 提交（Shift+Enter 换行）、Escape 取消。
 *
 * IME 规则单处承载：**组合中的 Enter 是确认候选词，不是提交**（中文输入法必踩）——
 * 消费方按返回值分发各自的提交/取消动作，键位判定不再两处各写一遍。
 *
 * @returns 'submit' | 'cancel' | null（其它按键不关心）
 */
export function commentTextareaAction(e: KeyboardEvent<HTMLTextAreaElement>): 'submit' | 'cancel' | null {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) return 'submit'
    if (e.key === 'Escape') return 'cancel'
    return null
}
