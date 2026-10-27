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
 * Mobi 当前仅支持 Claude Code
 */

// 顺序：按自由度递增，auto 置顶（日常推荐）
// auto(推荐) → manual(每次问) → acceptEdits → plan → dontAsk → yolo(全放行)
export const CLAUDE_PERMISSION_MODES = ['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'] as const
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number]

const CLAUDE_MODEL_PRESETS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'] as const
export type ClaudeModelPreset = typeof CLAUDE_MODEL_PRESETS[number]

/**
 * 模型兜底清单（宿主能力探针不可用时使用）。
 *
 * 单源在 shared：web 创建页 / 会话面板拿它渲染下拉，daemon 的 MCP 失败文案拿它
 * 告诉 agent「目录不可用时还能填什么」——两处各写一份必然漂移。
 *
 * 项形状刻意宽于 `ModelInfo`（description 可选、无能力位）：它是**手写常量**，
 * 不是探针结果，能力位未知就如实缺省。
 */
export const CLAUDE_MODEL_FALLBACK: readonly { value: string; displayName: string; description?: string }[] = [
    { value: 'auto', displayName: 'Auto', description: 'Use the default model' },
    { value: 'opus', displayName: 'Opus', description: 'Most capable for complex work' },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Best for everyday tasks' },
    { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers' },
]

// 顺序与 CLAUDE_PERMISSION_MODES 一致（自由度递增，auto 置顶）
export const PERMISSION_MODES = [
    'auto',
    'default',
    'acceptEdits',
    'plan',
    'dontAsk',
    'bypassPermissions'
] as const
export type PermissionMode = typeof PERMISSION_MODES[number]

// Mobi 当前仅支持 Claude
export type AgentFlavor = 'claude'

// 注意：default 对应 SDK 的 'default' 模式值（契约不可变），
// 但对用户展示为 'Request Approval'（每次操作都请求批准），避免 'Default' 含义模糊
export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
    auto: 'Auto',
    default: 'Request Approval',
    acceptEdits: 'Accept Edits',
    plan: 'Plan Mode',
    dontAsk: "Don't Ask",
    bypassPermissions: 'YOLO'
}

// 色调对齐 Claude CLI 配色（固定品牌色保证对比度，随主题仅 neutral）：
// auto=gold(金黄) · default=neutral(灰) · acceptEdits=purple(紫)
// · plan=green(绿) · dontAsk=danger(红) · bypassPermissions=danger(红, YOLO)
export type PermissionModeTone = 'neutral' | 'gold' | 'purple' | 'green' | 'danger'

export const PERMISSION_MODE_TONES: Record<PermissionMode, PermissionModeTone> = {
    auto: 'gold',
    default: 'neutral',
    acceptEdits: 'purple',
    plan: 'green',
    dontAsk: 'danger',
    bypassPermissions: 'danger'
}

export type PermissionModeOption = {
    mode: PermissionMode
    label: string
    tone: PermissionModeTone
}

export function getPermissionModeLabel(mode: PermissionMode): string {
    return PERMISSION_MODE_LABELS[mode]
}

export function getPermissionModeTone(mode: PermissionMode): PermissionModeTone {
    return PERMISSION_MODE_TONES[mode]
}

// Mobi 当前仅支持 Claude，简化函数
export function getPermissionModesForFlavor(_flavor?: string | null): readonly PermissionMode[] {
    return CLAUDE_PERMISSION_MODES
}

export function getPermissionModeOptionsForFlavor(_flavor?: string | null): PermissionModeOption[] {
    return CLAUDE_PERMISSION_MODES.map((mode) => ({
        mode,
        label: getPermissionModeLabel(mode),
        tone: getPermissionModeTone(mode)
    }))
}

export function isPermissionModeAllowedForFlavor(mode: PermissionMode, _flavor?: string | null): boolean {
    return CLAUDE_PERMISSION_MODES.includes(mode as ClaudePermissionMode)
}

export function isClaudeModelPreset(model: string | null | undefined): model is ClaudeModelPreset {
    return typeof model === 'string' && CLAUDE_MODEL_PRESETS.includes(model as ClaudeModelPreset)
}

// ============ Effort 级别 ============

/**
 * 可落盘档位：会写进偏好 / settings 文件的四档。
 * 用户偏好持久化只认这四档——`max` 是 session-only，写进偏好会跨会话失真。
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const

/**
 * 会话档位：可落盘四档 + `max`。
 * `max` 走 SDK 的 session-only 语义（启动 Options 与运行时 flag 层都接受，但不落盘），
 * 故协议校验、spawn 透传、运行时切换都以本清单为准；UI 展示再按模型能力二次过滤。
 */
export const EFFORT_SESSION_LEVELS = [...EFFORT_LEVELS, 'max'] as const

/** effort 全部合法取值（类型与协议校验单源） */
export type EffortLevel = typeof EFFORT_SESSION_LEVELS[number]

export const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'X-High',
    max: 'Max',
}

/**
 * 模型声明的档位能力（结构类型，避免与 schemas 的 ModelInfo 循环依赖；
 * 探针返回的 ModelInfo 天然满足）
 */
export interface ModelEffortCapability {
    supportsEffort?: boolean
    supportedEffortLevels?: readonly string[]
}

/**
 * 按模型能力解析可展示的档位集合。
 *
 * - 无模型信息（探针未就绪 / 兜底四项）：回落可落盘四档
 * - `supportsEffort === false`：返回空数组，调用方据此不渲染档位入口
 * - 声明了 `supportedEffortLevels`：按该清单过滤，保持由低到高的规范顺序
 *   （未知档位名丢弃）；声明为空视同未声明，回落四档
 */
export function resolveModelEffortLevels(model?: ModelEffortCapability | null): readonly EffortLevel[] {
    if (!model) return EFFORT_LEVELS
    if (model.supportsEffort === false) return []
    const declared = model.supportedEffortLevels
    if (!declared || declared.length === 0) return EFFORT_LEVELS
    return EFFORT_SESSION_LEVELS.filter(level => declared.includes(level))
}
