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
import { theme as antTheme } from 'antd'

/** antd 主题 token 类型（与各组件 useToken 返回一致） */
type SidebarToken = ReturnType<typeof antTheme.useToken>['token']

/**
 * 移动端菜单抽屉的顶级行样式（MobileMenu 菜单项与 InstallButton menu variant 共用）。
 *
 * 统一视觉规范（2026-08 重构，mockup 定稿）：
 * - 顶级行一律 15px / 500 左对齐（与项目分组头 GroupName 同档），
 *   子级会话行 14px、分区标签 13px，形成三级层次
 * - 双列行（主题/语言、刷新/重启）列内也用本样式左对齐，
 *   左列图标起点与其他行一致，不再居中
 */
export const MobileMenuItem = styled.div<{
    $active?: boolean
    $danger?: boolean
    $token: SidebarToken
}>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: ${props => {
        if (props.$danger) return props.$token.colorError
        return props.$active ? props.$token.colorPrimary : props.$token.colorText
    }};
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    transition: all 0.2s;
    ${props => props.$danger ? `border-top: 1px solid ${props.$token.colorBorder};` : ''}

    @media (hover: hover) {
        &:hover {
            background: ${props => props.$token.colorPrimaryBg};
        }
    }

    &:active {
        background: ${props => props.$token.colorPrimaryBg};
    }
`
