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
import { Button, Tag, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { EffortLevel, PermissionMode } from '@mobi/shared'
import {
    getPermissionModeTone,
    isPermissionModeAllowedForFlavor,
    EFFORT_LABELS
} from '@mobi/shared'
import { getContextBudgetTokens } from '@/domain/chat'
import { getPermissionModeColor } from './permissionModeColors'

interface StatusBarProps {
    /** 是否正在运行 */
    running: boolean
    /** 上下文大小 */
    contextSize?: number
    /** 当前模型 */
    model?: string | null
    /** 权限模式 */
    permissionMode?: PermissionMode
    /** Agent 类型 */
    agentFlavor?: string | null
    /** 中止回调 */
    onAbort?: () => void
    /** 中止请求中 */
    abortPending?: boolean
    /** 思考深度 */
    effort?: EffortLevel
}

/** 中止按钮图标：外圈旋转 + 内嵌实心方框（同 Ant Design X StopLoadingIcon） */
function AbortIcon() {
    return (
        <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" style={{ width: '1em', height: '1em' }}>
            {/* 中心方框 */}
            <rect fill="currentColor" height="250" rx="24" ry="24" width="250" x="375" y="375" />
            {/* 背景圆环 */}
            <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" strokeWidth="100" opacity="0.45" />
            {/* 旋转圆弧 */}
            <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" strokeWidth="100" strokeDasharray="600 9999999">
                <animateTransform attributeName="transform" dur="1s" from="0 500 500" repeatCount="indefinite" to="360 500 500" type="rotate" />
            </circle>
        </svg>
    )
}

/**
 * 状态栏组件
 * 显示连接状态、思考状态、上下文使用量和权限模式
 */
export function StatusBar(props: StatusBarProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()

    const {
        running,
        contextSize,
        model,
        permissionMode,
        agentFlavor,
        onAbort,
        abortPending = false,
        effort,
    } = props

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

    // 显示的思考深度（非默认值时才显示）
    const displayEffort = !running && effort && effort !== 'medium'
        ? effort
        : null

    const permissionModeLabel = displayPermissionMode ? t(`composer.permissionModes.${displayPermissionMode}`) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const permissionModeColor = getPermissionModeColor(token, permissionModeTone) ?? token.colorTextSecondary

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px 4px',
            fontSize: 12
        }}>
            {/* 左侧：上下文使用量 */}
            <div>
                {contextWarning && (
                    <span style={{ fontSize: 10, color: contextWarning.color }}>
                        {contextWarning.text}
                    </span>
                )}
            </div>

            {/* 右侧：中止按钮或权限模式 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {running && onAbort ? (
                    <Button
                        type="text"
                        size="small"
                        icon={<AbortIcon />}
                        loading={abortPending}
                        onClick={onAbort}
                        disabled={abortPending}
                        style={{
                            fontSize: 11,
                            color: token.colorError,
                            background: `color-mix(in srgb, ${token.colorError} 10%, transparent)`,
                            border: 'none',
                            borderRadius: 10,
                            padding: '1px 8px',
                            height: 'auto',
                            lineHeight: '18px',
                            transition: 'background 0.2s',
                        }}
                    >
                        {t('composer.abort')}
                    </Button>
                ) : displayPermissionMode ? (
                    <span style={{ fontSize: 12, color: permissionModeColor }}>
                        {permissionModeLabel}
                    </span>
                ) : null}
                {displayEffort && (
                    <Tag style={{ fontSize: 11, marginRight: 0 }}>{EFFORT_LABELS[displayEffort]}</Tag>
                )}
            </div>
        </div>
    )
}
