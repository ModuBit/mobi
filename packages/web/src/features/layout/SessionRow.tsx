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

import { Badge, Input, theme as antTheme } from 'antd'
import { EditOutlined, DeleteOutlined, MoonOutlined, MoreOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Pin, PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DropdownMenu, type DropdownItem } from '@/ui/shadcn/dropdown-menu/dropdown-menu'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { resolveForkSessionState } from './forkSessionLabel'
import { ForkStateBadge } from './ForkStateBadge'
import { SessionStatusDot } from './SessionStatusDot'
import type { Session } from '@/core/data/api/types'
import {
    SessionItem, SessionName, TimeLabel, SessionActions, ActionButton, RenameRow,
} from './sidebarWorkspaces.styles'

const { useToken } = antTheme

interface SessionRowProps {
    session: Session
    active: boolean
    isRenaming: boolean
    renameValue: string
    onRenameValueChange: (v: string) => void
    onRenameConfirm: () => void
    onRenameCancel: () => void
    onRenameLoading: boolean
    onClick: () => void
    onRename: () => void
    /** 手动休眠（dormancy spec §D.11）：gate 阻塞时弹「仍要退出」确认，行内不再有独立退出按钮 */
    onDormant: () => void
    dormantLoading?: boolean
    onResume: () => void
    onDelete: () => void
    /** 置顶 / 取消置顶（所有分组通用的行内操作） */
    onTogglePin: () => void
    /** 置顶操作进行中（仅该行禁用，其余行不受牵连） */
    pinLoading?: boolean
    /** dropdown 分组附加项（「归入工作区」/「移至最近」「换工作区」），渲染在休眠/删除之前 */
    extraMenuItems?: DropdownItem[]
}

/** 桌面侧边栏单个会话行（含行内重命名与 hover 操作）。
 *  行内只保留高频的 编辑 + 置顶；休眠/恢复/删除与分组附加项统一收进「更多」dropdown */
export function SessionRow({
    session, active, isRenaming,
    renameValue, onRenameValueChange, onRenameConfirm, onRenameCancel, onRenameLoading,
    onClick, onRename, onDormant, dormantLoading, onResume, onDelete, onTogglePin, pinLoading,
    extraMenuItems,
}: SessionRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const sessionBadge = useNotificationBadgeStore((s) => s.badges.get(session.id))
    const hasUnread = Boolean(sessionBadge && (sessionBadge.ready || sessionBadge.permission))
    // fork 行：daemon 建行时标题已落库（metadata.name 含「· 分叉」后缀），
    // 徽标状态纯函数可得（spec §4.3）
    const forkState = resolveForkSessionState(session, t)
    // menu 构建轻量（几个数组项），每渲染重建无成本：上游 SessionRowsList 对
    // extraMenuItems 每渲染传新引用，memo 永不命中；本组件未做 React.memo，
    // 菜单 items 也是内联字面量——引用稳定性在此层不成立也不需要。
    // 附加项由调用方直接产出 DropdownItem（动作随项走）
    const extraItems = extraMenuItems ?? []
    // 附加项与内置项之间的分隔（antd 用独立的 divider 项，uiarc 挂在「下一项之前」）——
    // 构造时就给出，不先建数组再回头原地改元素
    const primaryItem: DropdownItem = session.active
        ? { label: t('session.actions.dormant'), icon: <MoonOutlined />, disabled: dormantLoading, onSelect: onDormant }
        : { label: t('session.actions.resume'), icon: <PlayCircleOutlined />, onSelect: onResume }
    const builtinItems: DropdownItem[] = [
        { ...primaryItem, separatorBefore: extraItems.length > 0 },
        { label: t('session.actions.delete'), icon: <DeleteOutlined />, destructive: true, onSelect: onDelete },
    ]
    const menuItems: DropdownItem[] = [...extraItems, ...builtinItems]

    if (isRenaming) {
        return (
            <RenameRow $token={token}>
                <Input
                    size="small"
                    value={renameValue}
                    onChange={(e) => onRenameValueChange(e.target.value)}
                    onPressEnter={onRenameLoading ? undefined : onRenameConfirm}
                    onKeyDown={(e) => { if (e.key === 'Escape') onRenameCancel() }}
                    onBlur={onRenameCancel}
                    autoFocus
                    disabled={onRenameLoading}
                    placeholder={t('session.actions.rename')}
                    onClick={(e) => e.stopPropagation()}
                />
            </RenameRow>
        )
    }

    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt, t)
    // 未激活会话：状态点与标题一同减淡，退到背景层
    const inactive = !session.active

    return (
        <SessionItem $active={active} $token={token} onClick={onClick}>
            <SessionStatusDot session={session} />
            <AppTooltip title={displayName} mouseEnterDelay={0.5} placement="right">
                <SessionName $inactive={inactive}>{displayName}</SessionName>
            </AppTooltip>
            {(forkState.isPendingActivation || forkState.isActivationFailed) && (
                <ForkStateBadge
                    variant={forkState.isActivationFailed ? 'error' : 'pending'}
                    errorText={forkState.errorText}
                />
            )}
            {hasUnread && <Badge data-testid={`session-id-badge-${session.id}`} color="#fa541c" dot />}
            <TimeLabel $token={token} className="session-time">{relativeTime}</TimeLabel>
            <SessionActions className="session-actions">
                {/* 次要按钮（重命名 / 置顶）：仍按 hover 显隐；「更多」是菜单锚点必须常驻，
                    详见 sidebarWorkspaces.styles.ts 的 .session-actions 注释 */}
                <ActionButton className="session-action-secondary" $token={token} title={t('session.actions.rename')} onClick={(e) => { e.stopPropagation(); onRename() }}>
                    <EditOutlined style={{ fontSize: 11 }} />
                </ActionButton>
                <ActionButton
                    className="session-action-secondary"
                    $token={token}
                    disabled={pinLoading}
                    title={session.pinned ? t('session.actions.unpin') : t('session.actions.pin')}
                    onClick={(e) => { e.stopPropagation(); onTogglePin() }}
                >
                    {session.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                </ActionButton>
                <DropdownMenu
                    trigger={
                        <ActionButton $token={token} title={t('common.more')} onClick={(e) => e.stopPropagation()}>
                            <MoreOutlined style={{ fontSize: 11 }} />
                        </ActionButton>
                    }
                    items={menuItems}
                />
            </SessionActions>
        </SessionItem>
    )
}
