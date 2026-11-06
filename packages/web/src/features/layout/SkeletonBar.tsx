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

type Token = ReturnType<typeof antTheme.useToken>['token']

// 骨架占位 shimmer 动画（渐变位移，1.4s 一个来回）
const shimmer = keyframes`
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
`

/**
 * 骨架条：列表首次加载的占位块，会话列表（侧栏 / 移动端菜单）与归档页共用。
 * 只负责渐变与扫光节奏，尺寸由调用方内联给（宽度/高度/圆角随各端行结构不同）。
 */
export const SkeletonBar = styled.span<{ $token: Token }>`
    display: block;
    flex-shrink: 0;
    border-radius: var(--radius-pill);
    background: linear-gradient(
        90deg,
        ${p => p.$token.colorFillSecondary} 25%,
        ${p => p.$token.colorFill} 37%,
        ${p => p.$token.colorFillSecondary} 63%
    );
    background-size: 400% 100%;
    animation: ${shimmer} 1.4s ease infinite;
`
