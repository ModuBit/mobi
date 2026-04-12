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

import { useMemo } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentState, PermissionMode } from '@mobi/shared'
import {
    getPermissionModeLabel,
    getPermissionModeTone,
    isPermissionModeAllowedForFlavor
} from '@mobi/shared'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import { PixelAvatar } from '@/components/PixelAvatar/PixelAvatar'
import type { AgentStatus } from '@/components/PixelAvatar/types'

// 思考状态随机消息
const VIBING_MESSAGES = [
    "Accomplishing", "Actioning", "Actualizing", "Baking", "Booping", "Brewing",
    "Calculating", "Cerebrating", "Channelling", "Churning", "Clauding", "Coalescing",
    "Cogitating", "Computing", "Combobulating", "Concocting", "Conjuring", "Considering",
    "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Deciphering",
    "Deliberating", "Determining", "Discombobulating", "Divining", "Doing", "Effecting",
    "Elucidating", "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting",
    "Forging", "Forming", "Frolicking", "Generating", "Germinating", "Hatching",
    "Herding", "Honking", "Ideating", "Imagining", "Incubating", "Inferring",
    "Manifesting", "Marinating", "Meandering", "Moseying", "Mulling", "Mustering",
    "Musing", "Noodling", "Percolating", "Perusing", "Philosophising", "Pontificating",
    "Pondering", "Processing", "Puttering", "Puzzling", "Reticulating", "Ruminating",
    "Scheming", "Schlepping", "Shimmying", "Simmering", "Smooshing", "Spelunking",
    "Spinning", "Stewing", "Sussing", "Synthesizing", "Thinking", "Tinkering",
    "Transmuting", "Unfurling", "Unravelling", "Vibing", "Wandering", "Whirring",
    "Wibbling", "Wizarding", "Working", "Wrangling"
]

// 权限模式颜色映射
const PERMISSION_TONE_COLORS: Record<string, string> = {
    neutral: 'text-gray-500',
    info: 'text-blue-500',
    warning: 'text-amber-500',
    danger: 'text-red-500'
}

interface StatusBarProps {
    /** 会话 ID，用于生成一致的动态头像 */
    sessionId: string
    /** 会话是否活跃 */
    active: boolean
    /** 是否正在思考 */
    thinking: boolean
    /** Agent 状态 */
    agentState?: AgentState | null
    /** 上下文大小 */
    contextSize?: number
    /** 当前模型 */
    model?: string | null
    /** 权限模式 */
    permissionMode?: PermissionMode
    /** Agent 类型 */
    agentFlavor?: string | null
}

/**
 * 状态栏组件
 * 显示连接状态、思考状态、上下文使用量和权限模式
 */
export function StatusBar(props: StatusBarProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()

    const {
        sessionId,
        active,
        thinking,
        agentState,
        contextSize,
        model,
        permissionMode,
        agentFlavor
    } = props

    // 计算连接状态
    const connectionStatus = useMemo(() => {
        const hasPermissions = agentState?.requests && Object.keys(agentState.requests).length > 0

        if (!active) {
            return {
                text: t('status.offline'),
                agentStatus: 'inactive' as AgentStatus,
            }
        }

        if (hasPermissions) {
            return {
                text: t('status.permissionRequired'),
                agentStatus: 'awaiting_auth' as AgentStatus,
            }
        }

        if (thinking) {
            const vibingMessage = VIBING_MESSAGES[Math.floor(Math.random() * VIBING_MESSAGES.length)].toLowerCase() + '…'
            return {
                text: vibingMessage,
                agentStatus: 'outputting' as AgentStatus,
            }
        }

        return {
            text: t('status.online'),
            agentStatus: 'idle' as AgentStatus,
        }
    }, [active, thinking, agentState, t])

    // 计算上下文警告
    const contextWarning = useMemo(() => {
        if (contextSize === undefined) return null
        const maxContextSize = getContextBudgetTokens(model, agentFlavor)
        if (!maxContextSize) return null

        const percentageUsed = (contextSize / maxContextSize) * 100
        const percentageRemaining = Math.max(0, 100 - percentageUsed)
        const percent = Math.round(percentageRemaining)

        if (percentageRemaining <= 5) {
            return { text: t('status.percentLeft', { percent }), color: token.colorError }
        } else if (percentageRemaining <= 10) {
            return { text: t('status.percentLeft', { percent }), color: token.colorWarning }
        } else {
            return { text: t('status.percentLeft', { percent }), color: token.colorTextSecondary }
        }
    }, [contextSize, model, agentFlavor, t, token])

    // 显示的权限模式
    const displayPermissionMode = permissionMode
        && permissionMode !== 'default'
        && isPermissionModeAllowedForFlavor(permissionMode, agentFlavor)
        ? permissionMode
        : null

    const permissionModeLabel = displayPermissionMode ? getPermissionModeLabel(displayPermissionMode) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const permissionModeColor = permissionModeTone
        ? (PERMISSION_TONE_COLORS[permissionModeTone] || token.colorTextSecondary)
        : token.colorTextSecondary

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px 4px',
            fontSize: 12
        }}>
            {/* 左侧：动态头像 + 连接状态和上下文 */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PixelAvatar name={sessionId} status={connectionStatus.agentStatus} size={18} />
                    <span style={{ color: token.colorTextSecondary, fontSize: 11 }}>
                        {connectionStatus.text}
                    </span>
                </div>
                {contextWarning && (
                    <span style={{ fontSize: 10, color: contextWarning.color }}>
                        {contextWarning.text}
                    </span>
                )}
            </div>

            {/* 右侧：权限模式 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {displayPermissionMode && (
                    <span style={{ fontSize: 12, color: permissionModeColor }}>
                        {permissionModeLabel}
                    </span>
                )}
            </div>
        </div>
    )
}
