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
import { UserRoundX } from 'lucide-react'
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
 * TeamDelete 工具视图
 * 展示 team_name 和 message 内容
 */
export function TeamDeleteView(props: ToolViewProps) {
    const { token } = useToken()
    const resultObj = parseResultObject(props.block.tool.result)

    const teamName = resultObj ? getField<string>(resultObj, 'team_name') : undefined
    const message = resultObj ? getField<string>(resultObj, 'message') : undefined
    const success = resultObj ? getField<boolean>(resultObj, 'success') : undefined

    const isSuccess = success === true
    const iconColor = isSuccess ? token.colorSuccess : token.colorError
    const iconBg = isSuccess ? token.colorSuccessBg : token.colorErrorBg

    return (
        <div style={{
            display: 'flex',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 6,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgLayout,
        }}>
            <div style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 8,
                background: iconBg,
                color: iconColor,
            }}>
                <UserRoundX size={18} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                {teamName ? (
                    <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: token.colorText,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {teamName}
                    </div>
                ) : null}

                {message ? (
                    <div style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: isSuccess ? token.colorTextSecondary : token.colorError,
                    }}>
                        {message}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
