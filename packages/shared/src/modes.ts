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

export const CLAUDE_MODEL_PRESETS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'] as const
export type ClaudeModelPreset = typeof CLAUDE_MODEL_PRESETS[number]

export const CLAUDE_MODEL_LABELS: Record<ClaudeModelPreset, string> = {
    sonnet: 'Sonnet',
    'sonnet[1m]': 'Sonnet 1M',
    opus: 'Opus',
    'opus[1m]': 'Opus 1M'
}

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

export function getClaudeModelLabel(model: string): string | null {
    const trimmedModel = model.trim()
    if (!trimmedModel) {
        return null
    }

    return CLAUDE_MODEL_LABELS[trimmedModel as ClaudeModelPreset] ?? null
}

// ============ Effort 级别 ============

// 注意：不包含 'max' 级别
// SDK Options.effort 接受 'max'，但 applyFlagSettings（运行时动态修改）的
// effortLevel 类型为 'low' | 'medium' | 'high' | 'xhigh'，不含 'max'
// 为保持启动时和运行时一致，仅列出四个级别
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const
export type EffortLevel = typeof EFFORT_LEVELS[number]

export const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'X-High',
}

export function getEffortOptions(): Array<{ value: EffortLevel; label: string }> {
    return EFFORT_LEVELS.map(e => ({ value: e, label: EFFORT_LABELS[e] }))
}
