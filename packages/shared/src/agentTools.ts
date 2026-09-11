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

import { isObject } from './utils'

/**
 * Agent 类工具的判定单源：hub 前台任务投影（foregroundTasks）与 web 工具卡片
 * （knownTools）共用，SDK 改名/新增别名只改此处。
 */

/** Agent 工具双名（Task 为旧名 / Agent 为新名，SDK 并存） */
export const AGENT_TOOL_NAMES = ['Task', 'Agent'] as const

/** 判断工具名是否为 Agent 类工具 */
export function isAgentToolName(name: string): boolean {
    return (AGENT_TOOL_NAMES as readonly string[]).includes(name)
}

/** Agent 工具输入的显式后台标记（run_in_background=true）——前后台分流判据 */
export function isBackgroundAgentInput(input: unknown): boolean {
    return isObject(input) && input.run_in_background === true
}
