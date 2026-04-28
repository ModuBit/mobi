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

import type { ComponentType } from 'react'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { EditView } from '@/components/tool-card/views/EditView'
import { AskUserQuestionView } from '@/components/tool-card/views/AskUserQuestionView'
import { RequestUserInputView } from '@/components/tool-card/views/RequestUserInputView'
import { ExitPlanModeView } from '@/components/tool-card/views/ExitPlanModeView'
import { MultiEditFullView, MultiEditView } from '@/components/tool-card/views/MultiEditView'
import { TodoWriteView } from '@/components/tool-card/views/TodoWriteView'
import { UpdatePlanView } from '@/components/tool-card/views/UpdatePlanView'
import { WriteView } from '@/components/tool-card/views/WriteView'
import { ReadDetailView } from '@/components/tool-card/views/ReadDetailView'
import { BashView } from '@/components/tool-card/views/BashView'

export type ToolViewProps = {
    block: ToolCallBlock
    metadata: SessionMetadataSummary | null
}

export type ToolViewComponent = ComponentType<ToolViewProps>

export const toolViewRegistry: Record<string, ToolViewComponent> = {
    Bash: BashView,
    shell_command: BashView,
    Edit: EditView,
    MultiEdit: MultiEditView,
    Write: WriteView,
    TodoWrite: TodoWriteView,
    update_plan: UpdatePlanView,
    AskUserQuestion: AskUserQuestionView,
    ExitPlanMode: ExitPlanModeView,
    ask_user_question: AskUserQuestionView,
    exit_plan_mode: ExitPlanModeView,
    request_user_input: RequestUserInputView
}

export const toolFullViewRegistry: Record<string, ToolViewComponent> = {
    Edit: EditView,
    MultiEdit: MultiEditFullView,
    Write: WriteView,
    Read: ReadDetailView,
    AskUserQuestion: AskUserQuestionView,
    ExitPlanMode: ExitPlanModeView,
    ask_user_question: AskUserQuestionView,
    exit_plan_mode: ExitPlanModeView,
    request_user_input: RequestUserInputView
}

export function getToolViewComponent(toolName: string): ToolViewComponent | null {
    return toolViewRegistry[toolName] ?? null
}

export function getToolFullViewComponent(toolName: string): ToolViewComponent | null {
    return toolFullViewRegistry[toolName] ?? null
}
