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

import { theme as antTheme } from 'antd'
import { TeamOutlined, UserOutlined } from '@ant-design/icons'
import { getField, isObject } from '@mobi/shared'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { extractTextFromResult } from '@/components/tool-card/views/_results'

const { useToken } = antTheme

/** 从 result 中解析出结构化对象 */
function parseResultObject(result: unknown): Record<string, unknown> | null {
    const text = extractTextFromResult(result)
    if (!text) return null
    try {
        const parsed = JSON.parse(text)
        return isObject(parsed) ? parsed : null
    } catch {
        return null
    }
}

/**
 * TeamCreate 工具视图
 * 名片风格展示 team_name、description、lead_agent_id
 */
export function TeamCreateView(props: ToolViewProps) {
    const { token } = useToken()
    const input = props.block.tool.input
    const resultObj = parseResultObject(props.block.tool.result)

    const teamName = isObject(input) ? getField<string>(input, 'team_name') : undefined
    const description = isObject(input) ? getField<string>(input, 'description') : undefined
    const leadAgentId = resultObj ? getField<string>(resultObj, 'lead_agent_id') : undefined

    return (
        <div style={{
            display: 'flex',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgLayout,
        }}>
            {/* 左侧：团队图标 */}
            <div style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                fontSize: 18,
            }}>
                <TeamOutlined />
            </div>

            {/* 右侧：信息区 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: token.colorText,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {teamName ?? 'Create Team'}
                </div>

                {description ? (
                    <div style={{
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        lineHeight: 1.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                    }}>
                        {description}
                    </div>
                ) : null}

                {leadAgentId ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 2,
                        fontSize: 11,
                        color: token.colorTextTertiary,
                    }}>
                        <UserOutlined style={{ fontSize: 10 }} />
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{leadAgentId}</span>
                    </div>
                ) : null}
            </div>
        </div>
    )
}
