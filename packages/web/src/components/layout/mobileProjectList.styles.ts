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

// ========== 移动端项目列表样式组件 ==========

export const Container = styled.div<{ $token: SidebarToken }>`
    display: flex;
    flex-direction: column;
    border-top: 1px solid ${props => props.$token.colorBorderSecondary};
    border-bottom: 1px solid ${props => props.$token.colorBorderSecondary};
    margin: 4px 0;
    padding: 4px 0;
    background: ${props => props.$token.colorBgLayout};
`

// 分区标题行（可点击折叠分区，右侧可承载操作按钮）
export const SectionHeader = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 20px 4px;
    font-size: 13px;
    font-weight: 600;
    color: ${props => props.$token.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    user-select: none;
`

// 分区标题文字（flex:1 撑开，右侧留出操作按钮位）
export const SectionTitleText = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 分区折叠指示箭头（展开时旋转 90°）
export const SectionChevron = styled.span<{ $expanded: boolean; $token: SidebarToken }>`
    display: inline-flex;
    flex-shrink: 0;
    transform: rotate(${props => props.$expanded ? 90 : 0}deg);
    transition: transform 0.15s ease;
`

// 项目头
export const GroupHeader = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 20px;
    cursor: pointer;
    transition: background 0.15s;

    &:active {
        background: ${props => props.$token.colorPrimaryBg};
    }
`

// 文件夹图标
export const FolderIcon = styled.span<{ $token: SidebarToken }>`
    display: inline-flex;
    color: ${props => props.$token.colorTextTertiary};
`

// 项目名称
export const GroupName = styled.span<{ $token: SidebarToken }>`
    flex: 1;
    font-size: 15px;
    font-weight: 500;
    color: ${props => props.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 新建会话按钮（常驻可见）
export const NewSessionBtn = styled.button<{ $token: SidebarToken }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;

    &:active {
        background: ${props => props.$token.colorBgTextHover};
        color: ${props => props.$token.colorText};
    }
`

// 会话列表动画容器（grid-row 高度动画）
export const SessionListWrapper = styled.div<{ $expanded: boolean }>`
    display: grid;
    grid-template-rows: ${props => props.$expanded ? '1fr' : '0fr'};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: grid-template-rows 0.2s ease, opacity 0.15s ease;
`

export const SessionListInner = styled.div`
    overflow: hidden;
`

// 单个会话项
export const SessionItem = styled.div<{ $active: boolean; $token: SidebarToken }>`
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 12px 0 50px;
    cursor: pointer;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    transition: background 0.15s;
    /* 长按交互：禁止选中文本与系统长按菜单 */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;

    &:active {
        background: ${props => props.$active ? props.$token.colorPrimaryBg : props.$token.colorBgTextHover};
    }
`

// 会话名称
export const SessionName = styled.span<{ $token: SidebarToken }>`
    flex: 1;
    font-size: 14px;
    color: ${props => props.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 相对时间
export const TimeLabel = styled.span<{ $token: SidebarToken }>`
    flex-shrink: 0;
    font-size: 12px;
    color: ${props => props.$token.colorTextQuaternary};
    white-space: nowrap;
`

// ⋮ 更多按钮
export const MoreButton = styled.button<{ $token: SidebarToken }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;

    &:active {
        color: ${props => props.$token.colorText};
    }
`

// 空态占位行（分组无会话时展示，行高对齐 SessionItem）
export const EmptyRow = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    min-height: 40px;
    padding: 0 12px 0 50px;
    font-size: 13px;
    color: ${props => props.$token.colorTextQuaternary};
`
