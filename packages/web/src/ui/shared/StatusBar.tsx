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

import type { GoalStatus } from '@mobi/shared'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { GoalRow } from '@/ui/shared/GoalRow'

interface StatusBarProps {
    /** goal 状态（有值时渲染整行目标状态；无值返回 null 不占布局高度） */
    goal?: GoalStatus | null
    /** sessionId（goal 清理用，与 onClearGoal 同时传入） */
    sessionId?: string
    /** goal 清理回调（与 sessionId 同时传入时行尾带清理动作） */
    onClearGoal?: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * 状态栏：composer 输入框上方的独立状态行，当前只承载 goal。
 *
 * running 指示已回归聊天流末尾（AgentLoadingBubble 作为列表尾行的系统动作行），
 * 缓存过期提示改为聊天流里的 CacheExpiredRow——状态栏因此只剩 goal，
 * 且 goal 独占整行（ChatGPT desktop 形态），不再与其它 chip 挤在右侧。
 *
 * 空态返回 null：ComposerDock 依赖「直接子元素只剩 wrapper 一个」判定退场（见 ChatComposer）。
 */
export function StatusBar({ goal, sessionId, onClearGoal }: StatusBarProps) {
    if (goal == null) return null
    return <GoalRow goal={goal} sessionId={sessionId} onClear={onClearGoal} />
}
