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

import type { EditorState } from '@tiptap/pm/state'

/**
 * 换行键（PC Shift+Enter / 触屏 Enter）的上下文语义单源。
 *
 * 提交键位（PC Enter / 触屏 Shift+Enter）不在这里判定——这是「换行」键的分流：
 * - 代码块内：代码内换行（保持单一代码块）
 * - 列表项内：新建列表项；空列表项：退出列表
 * - 标题末尾：落到普通段落（避免连续标题）
 * - 其他：新段落
 */
export type NewlineAction = 'newlineInCode' | 'splitListItem' | 'liftListItem' | 'exitHeading' | 'splitBlock'

/** 按光标所在节点决定换行动作（纯函数：只读 state，便于单测） */
export function resolveNewlineAction(state: EditorState): NewlineAction {
    const { $from } = state.selection
    if ($from.parent.type.name === 'codeBlock') return 'newlineInCode'

    for (let depth = $from.depth; depth > 0; depth--) {
        // 列表项内的段落节点就是 $from.parent（嵌套列表时更深层的项优先）
        if ($from.node(depth).type.name === 'listItem') {
            return $from.parent.content.size === 0 ? 'liftListItem' : 'splitListItem'
        }
    }

    if ($from.parent.type.name === 'heading') return 'exitHeading'
    return 'splitBlock'
}
