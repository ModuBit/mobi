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

export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number]

export const CLAUDE_MODEL_PRESETS = ['sonnet', 'sonnet[1m]', 'opus', 'opus[1m]'] as const
export type ClaudeModelPreset = typeof CLAUDE_MODEL_PRESETS[number]

export const CLAUDE_MODEL_LABELS: Record<ClaudeModelPreset, string> = {
    sonnet: 'Sonnet',
    'sonnet[1m]': 'Sonnet 1M',
    opus: 'Opus',
    'opus[1m]': 'Opus 1M'
}

// Mobi 当前仅支持 Claude，简化权限模式
export const PERMISSION_MODES = [
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan'
] as const
export type PermissionMode = typeof PERMISSION_MODES[number]

// Mobi 当前仅支持 Claude
export type AgentFlavor = 'claude'

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
    default: 'Default',
    acceptEdits: 'Accept Edits',
    plan: 'Plan Mode',
    bypassPermissions: 'Yolo'
}

export type PermissionModeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'

export const PERMISSION_MODE_TONES: Record<PermissionMode, PermissionModeTone> = {
    default: 'neutral',
    acceptEdits: 'warning',
    plan: 'success',
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
