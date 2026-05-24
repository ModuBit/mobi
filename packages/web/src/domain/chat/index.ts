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

// 类型导出
export type {
    UsageData,
    AgentEvent,
    ToolResultPermission,
    ToolUse,
    ToolResult,
    NormalizedAgentContent,
    NormalizedMessage,
    ToolPermission,
    ChatToolCall,
    UserTextBlock,
    AgentTextBlock,
    AgentReasoningBlock,
    CliOutputBlock,
    AgentEventBlock,
    ToolCallBlock,
    ChatBlock
} from './types'

// 追踪器
export type { TracedMessage } from './tracer'
export { traceMessages } from './tracer'

// 标准化
export { normalizeDecryptedMessage } from './normalize'
export { normalizeUserRecord } from './normalizeUser'
export { normalizeAgentRecord, isSkippableAgentContent } from './normalizeAgent'

// 归约器
export type { LatestUsage } from './reducer'
export { reduceChatBlocks } from './reducer'

// 归约器工具
export type { PermissionEntry } from './reducerTools'
export {
    getPermissions,
    ensureToolBlock,
    collectToolIdsFromMessages,
    isChangeTitleToolName,
    extractTitleFromChangeTitleInput,
    collectTitleChanges
} from './reducerTools'

// 事件处理
export { parseMessageAsEvent, dedupeAgentEvents, foldApiErrorEvents } from './reducerEvents'
export { formatEvent, extractApiErrorDetail } from './eventFormatter'

// CLI 输出处理
export { isCliOutputText, createCliOutputBlock, mergeCliOutputBlocks } from './reducerCliOutput'
export { parseCliOutputText } from './cliParser'

// 块协调
export type { ChatBlocksById } from './reconcile'
export { reconcileChatBlocks } from './reconcile'

// 展示逻辑
export type { EventPresentation } from './presentation'
export { formatUnixTimestamp, getEventPresentation, renderEventLabel } from './presentation'

// 模型配置
export { getContextBudgetTokens } from './modelConfig'

// Agent 提取
export type { RunningAgent } from './extractRunningAgents'
export { extractRunningAgents } from './extractRunningAgents'
