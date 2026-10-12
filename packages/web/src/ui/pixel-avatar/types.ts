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

// AgentStatus 定义已迁 core/utils/agentStatus（分层治理票 01）——会话状态语义归 core，
// 此处重导出维持 pixel-avatar 域内既有引用面（sprites/animations、PixelAvatar 等）
export type { AgentStatus } from '@/core/utils/agentStatus'
import type { AgentStatus } from '@/core/utils/agentStatus'

/** 根据 session 状态计算 AgentStatus */
export function getAgentStatus(opts: {
    active: boolean
    running: boolean
    agentState?: { requests?: Record<string, unknown> | null } | null
}): AgentStatus {
    const hasPermissions = opts.agentState?.requests && Object.keys(opts.agentState.requests).length > 0
    if (!opts.active) return 'inactive'
    if (hasPermissions) return 'awaiting_auth'
    if (opts.running) return 'outputting'
    return 'idle'
}

export type PixelColor = string;

export interface SpritePart {
    pixels: [number, number, PixelColor][];
}

export interface CharacterSprite {
    hair: SpritePart;
    face: SpritePart;
    eyes: SpritePart;
    outfit: SpritePart;
    accessory: SpritePart;
    body: SpritePart;
}

export interface AnimationSet {
    frames: [number, number, PixelColor][][];
    interval: number;
}

export interface StatusStyle {
    /** 容器背景色，设为 'none' 则透明 */
    background?: string;
    /** 边框样式，设为 'none' 则无边框 */
    border?: string;
    /** 发光效果，设为 'none' 则无发光 */
    glow?: string;
    /** CSS animation 名称，设为 'none' 则禁用动画 */
    animation?: string;
}

export interface PixelAvatarProps {
    name?: string;
    character?: CharacterSprite;
    status: AgentStatus;
    size?: number;
    showLabel?: boolean;
    /** 状态样式映射，可覆盖各状态的背景/边框/发光/动画 */
    statusStyles?: Partial<Record<AgentStatus, StatusStyle>>;
}
