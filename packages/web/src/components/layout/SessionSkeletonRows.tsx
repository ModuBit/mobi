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

import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { theme as antTheme } from 'antd'

/** antd 主题 token 类型（与各组件 useToken 返回一致） */
type Token = ReturnType<typeof antTheme.useToken>['token']

/** 端别：桌面侧边栏 / 移动端菜单（骨架行高与内边距不同） */
export type SessionListVariant = 'desktop' | 'mobile'

// 骨架占位 shimmer 动画
const shimmer = keyframes`
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
`

// 会话行骨架（首次加载时占位，行高对齐各端 SessionItem）
const SkeletonRow = styled.div<{ $token: Token; $variant: SessionListVariant }>`
    display: flex;
    align-items: center;
    gap: ${props => props.$variant === 'mobile' ? '10px' : '8px'};
    ${props => props.$variant === 'mobile'
        ? 'min-height: 44px;\n    padding: 0 12px 0 50px;'
        : 'height: 30px;\n    padding: 0 8px 0 26px;'}

    & > .sk-bar {
        height: ${props => props.$variant === 'mobile' ? '10px' : '8px'};
        border-radius: ${props => props.$variant === 'mobile' ? '5px' : '4px'};
        background: linear-gradient(
            90deg,
            ${props => props.$token.colorFillSecondary} 25%,
            ${props => props.$token.colorFill} 37%,
            ${props => props.$token.colorFillSecondary} 63%
        );
        background-size: 400% 100%;
        animation: ${shimmer} 1.4s ease infinite;
    }
`

interface SessionSkeletonRowsProps {
    variant: SessionListVariant
    /** 骨架行数（沿用既有差异：桌面 3 行、移动端项目组 3 行 / 「最近」组 2 行） */
    rows: number
}

/** 会话列表首次加载骨架（桌面侧边栏与移动端菜单共用） */
export function SessionSkeletonRows({ variant, rows }: SessionSkeletonRowsProps) {
    const { token } = antTheme.useToken()

    return (
        <>
            {Array.from({ length: rows }, (_, idx) => (
                <SkeletonRow key={idx} $token={token} $variant={variant}>
                    <span className="sk-bar" style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                    <span className="sk-bar" style={{ flex: 1 }} />
                </SkeletonRow>
            ))}
        </>
    )
}
