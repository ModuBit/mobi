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

import { type CSSProperties, type ReactNode } from 'react'
import { theme as antTheme } from 'antd'

const { useToken } = antTheme

export type ToolViewPanelProps = {
    header?: ReactNode
    style?: CSSProperties
    children: ReactNode
} & Pick<React.HTMLAttributes<HTMLDivElement>, 'onMouseOver' | 'onMouseOut'>

/**
 * 工具视图通用面板：header(灰色标题栏) + content(内容区)
 */
export function ToolViewPanel({ header, style, children, ...rest }: ToolViewPanelProps) {
    const { token } = useToken()

    return (
        <div
            style={{
                overflow: 'hidden',
                borderRadius: 4,
                border: `1px solid ${token.colorBorder}`,
                background: token.colorBgContainer,
                ...style,
            }}
            {...rest}
        >
            {header && (
                <div style={{
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgLayout,
                    padding: '4px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: token.colorTextSecondary,
                }}>
                    {header}
                </div>
            )}
            {children}
        </div>
    )
}
