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

import { useMemo, useState, type MouseEvent } from 'react'
import { Badge, Dropdown, Input, theme as antTheme } from 'antd'
import type { MenuProps } from 'antd'
import { EditOutlined, DeleteOutlined, MoonOutlined, MoreOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Pin, PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { resolveForkSessionState } from './forkSessionLabel'
import { ForkStateBadge } from './ForkStateBadge'
import { SessionStatusDot } from './SessionStatusDot'
import type { Session } from '@/core/data/api/types'
import {
    SessionItem, SessionName, TimeLabel, SessionActions, ActionButton, RenameRow,
} from './sidebarProjects.styles'

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
    /** dropdown 分组附加项（「归入项目」/「移至最近」「换项目」），渲染在休眠/删除之前 */
    extraMenuItems?: MenuProps['items']
    /** dropdown 附加项点击（key 为调用方的 item key） */
    onExtraMenuClick?: (key: string) => void
}

/** dropdown 内休眠/恢复/删除项的 key（与附加项 key 区分） */
const DORMANT_KEY = 'dormant'
const RESUME_KEY = 'resume'
const DELETE_KEY = 'delete'

/** 桌面侧边栏单个会话行（含行内重命名与 hover 操作）。
 *  行内只保留高频的 编辑 + 置顶；休眠/恢复/删除与分组附加项统一收进「更多」dropdown */
export function SessionRow({
    session, active, isRenaming,
    renameValue, onRenameValueChange, onRenameConfirm, onRenameCancel, onRenameLoading,
    onClick, onRename, onDormant, dormantLoading, onResume, onDelete, onTogglePin, pinLoading,
    extraMenuItems, onExtraMenuClick,
}: SessionRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const sessionBadge = useNotificationBadgeStore((s) => s.badges.get(session.id))
    const hasUnread = Boolean(sessionBadge && (sessionBadge.ready || sessionBadge.permission))
    // fork 行：hub 建行时标题已落库（metadata.name 含「· 分叉」后缀），
    // 徽标状态纯函数可得（spec §4.3）
    const forkState = resolveForkSessionState(session, t)
    // dropdown 打开时鼠标移向 portal 菜单会离开行 → hover CSS 隐藏按钮组 → 触发器卸载导致菜单关闭。
    // 受控 open，打开期间强制显示按钮组
    const [menuOpen, setMenuOpen] = useState(false)

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
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                />
            </RenameRow>
        )
    }

    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt, t)
    // 未激活会话：状态点与标题一同减淡，退到背景层
    const inactive = !session.active

    // 稳定引用：本行处于重命名键击/徽标变化驱动的全列表重渲染热路径，
    // menu/handler 每渲染重建会让 Dropdown prop 恒新
    const menuItems: MenuProps['items'] = useMemo(() => [
        ...(extraMenuItems ?? []),
        ...(extraMenuItems?.length ? [{ type: 'divider' as const }] : []),
        session.active
            ? { key: DORMANT_KEY, icon: <MoonOutlined />, label: t('session.actions.dormant'), disabled: dormantLoading }
            : { key: RESUME_KEY, icon: <PlayCircleOutlined />, label: t('session.actions.resume') },
        { key: DELETE_KEY, icon: <DeleteOutlined />, danger: true, label: t('session.actions.delete') },
    ], [extraMenuItems, session.active, dormantLoading, t])
    const handleMenuClick: MenuProps['onClick'] = useMemo(() => ({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (key === DORMANT_KEY) onDormant()
        else if (key === RESUME_KEY) onResume()
        else if (key === DELETE_KEY) onDelete()
        else onExtraMenuClick?.(key)
    }, [onDormant, onResume, onDelete, onExtraMenuClick])

    return (
        <SessionItem $active={active} $token={token} onClick={onClick} data-menu-open={menuOpen || undefined}>
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
                <ActionButton $token={token} title={t('session.actions.rename')} onClick={(e) => { e.stopPropagation(); onRename() }}>
                    <EditOutlined style={{ fontSize: 11 }} />
                </ActionButton>
                <ActionButton
                    $token={token}
                    disabled={pinLoading}
                    title={session.pinned ? t('session.actions.unpin') : t('session.actions.pin')}
                    onClick={(e) => { e.stopPropagation(); onTogglePin() }}
                >
                    {session.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                </ActionButton>
                <Dropdown
                    menu={{ items: menuItems, onClick: handleMenuClick }}
                    trigger={['click']}
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                >
                    <ActionButton $token={token} title={t('common.more')} onClick={(e) => e.stopPropagation()}>
                        <MoreOutlined style={{ fontSize: 11 }} />
                    </ActionButton>
                </Dropdown>
            </SessionActions>
        </SessionItem>
    )
}
