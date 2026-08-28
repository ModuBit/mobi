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

// ========== 桌面侧边栏项目列表样式组件 ==========

// 整体容器
export const Container = styled.div`
    display: flex;
    flex-direction: column;
    padding: 4px 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
`

// 分区标题行（可点击折叠分区 + hover 显示的「新建项目」等按钮）
export const SectionTitleRow = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 4px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;

    .section-extra {
        visibility: hidden;
    }
    &:hover .section-extra {
        visibility: visible;
    }
`

// 分区折叠指示箭头（展开时旋转 90°）
export const SectionChevron = styled.span<{ $expanded: boolean; $token: SidebarToken }>`
    display: inline-flex;
    flex-shrink: 0;
    color: ${props => props.$token.colorTextQuaternary};
    transform: rotate(${props => props.$expanded ? 90 : 0}deg);
    transition: transform 0.15s ease;
`

// 分区标题
export const SectionTitle = styled.div<{ $token: SidebarToken }>`
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: ${props => props.$token.colorTextQuaternary};
`

// 分区标题上的小操作按钮（新建项目 / 新建游离会话）
export const SectionActionButton = styled.button<{ $token: SidebarToken }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${props => props.$token.colorText};
        background: ${props => props.$token.colorBgTextHover};
    }
`

// 项目分组容器
export const GroupContainer = styled.div`
    margin-bottom: 4px;
`

// 项目头：文件夹图标 + 名称
export const GroupHeader = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    font-weight: 500;
    text-align: left;
    transition: background 0.15s;
    color: ${props => props.$token.colorText};

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
    }

    /* 头部操作按钮：默认隐藏，hover 时显示 */
    .header-actions {
        display: none;
    }
    &:hover .header-actions {
        display: inline-flex;
    }
`

// 头部操作按钮（新建会话 / 更多菜单，hover 时通过 GroupHeader 的 CSS 显示）
export const HeaderActionButton = styled.button<{ $token: SidebarToken }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${props => props.$token.colorText};
        background: ${props => props.$token.colorBgTextHover};
    }
`

// 文件夹图标
export const FolderIcon = styled.span<{ $token: SidebarToken }>`
    display: inline-flex;
    font-size: 14px;
    color: ${props => props.$token.colorTextTertiary};
`

// 项目名称
export const GroupName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 会话列表动画容器（grid-row 高度动画）
export const SessionListWrapper = styled.div<{ $expanded: boolean }>`
    display: grid;
    grid-template-rows: ${props => props.$expanded ? '1fr' : '0fr'};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: grid-template-rows 0.2s ease, opacity 0.15s ease;
`

// 会话列表内容（overflow hidden 配合 grid 动画）
export const SessionListInner = styled.div`
    overflow: hidden;
`

// 会话列表
export const SessionListContainer = styled.div`
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0;
`

// 单个会话项
export const SessionItem = styled.div<{
    $active: boolean
    $token: SidebarToken
}>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px 0 26px;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => props.$token.colorText};
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    text-align: left;
    transition: background 0.15s;

    &:hover {
        background: ${props => props.$active ? props.$token.colorPrimaryBg : props.$token.colorBgTextHover};
    }

    /* 操作按钮：默认隐藏，hover 时显示 */
    .session-actions {
        display: none;
    }
    &:hover .session-actions {
        display: inline-flex;
    }
    /* hover 时隐藏时间 */
    &:hover .session-time {
        display: none;
    }
`

// 会话名称
export const SessionName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 相对时间
export const TimeLabel = styled.span<{ $token: SidebarToken }>`
    flex-shrink: 0;
    font-size: 11px;
    color: ${props => props.$token.colorTextQuaternary};
    white-space: nowrap;
`

// 操作按钮组
export const SessionActions = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
`

// 单个操作按钮
export const ActionButton = styled.button<{ $token: SidebarToken; $danger?: boolean }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: ${props => props.$danger ? props.$token.colorError : props.$token.colorTextTertiary};
    border-radius: 4px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;

    &:hover {
        color: ${props => props.$danger ? props.$token.colorError : props.$token.colorText};
        background: ${props => props.$token.colorBgTextHover};
    }
`

// 重命名行（紧凑：仅 Input，Enter 确认 Esc 取消）
export const RenameRow = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    width: 100%;
    height: 30px;
    padding: 0 8px 0 26px;

    .ant-input {
        flex: 1;
        font-size: 12px;
        height: 24px;
        padding: 0 6px;
        border-radius: ${props => props.$token.borderRadiusSM}px;
    }

    .ant-input:focus {
        box-shadow: 0 0 0 2px ${props => props.$token.colorPrimaryBg};
    }
`

// 空态占位行（分组无会话时展示，行高与骨架行对齐）
export const EmptyRow = styled.div<{ $token: SidebarToken }>`
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 8px 0 26px;
    font-size: 12px;
    color: ${props => props.$token.colorTextQuaternary};
`
