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

import type React from 'react'
import { Badge, Input, theme as antTheme } from 'antd'
import { EditOutlined, InboxOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Pin, PinOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppTooltip } from '@/components/ui/AppTooltip'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { getSessionAvatarStatus } from '@/core/utils/sessionStatus'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
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
    onArchive: () => void
    onResume: () => void
    onDelete: () => void
    /** 置顶 / 取消置顶（所有分组通用的行内操作） */
    onTogglePin: () => void
    /** 置顶操作进行中（仅该行禁用，其余行不受牵连） */
    pinLoading?: boolean
    /** 追加操作（「移至最近」/「归入项目」等 Dropdown 入口） */
    extraAction?: React.ReactNode
}

/** 桌面侧边栏单个会话行（含行内重命名与 hover 操作） */
export function SessionRow({
    session, active, isRenaming,
    renameValue, onRenameValueChange, onRenameConfirm, onRenameCancel, onRenameLoading,
    onClick, onRename, onArchive, onResume, onDelete, onTogglePin, pinLoading, extraAction,
}: SessionRowProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const sessionBadge = useNotificationBadgeStore((s) => s.badges.get(session.id))
    const hasUnread = Boolean(sessionBadge && (sessionBadge.ready || sessionBadge.permission))

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
    const avatarStatus = getSessionAvatarStatus(session)

    return (
        <SessionItem $active={active} $token={token} onClick={onClick}>
            <StatusStateIcon state={avatarStatus} style={{ width: 10, height: 10 }} />
            <AppTooltip title={displayName} mouseEnterDelay={0.5} placement="right">
                <SessionName>{displayName}</SessionName>
            </AppTooltip>
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
                {session.active ? (
                    <ActionButton $token={token} title={t('session.actions.archive')} onClick={(e) => { e.stopPropagation(); onArchive() }}>
                        <InboxOutlined style={{ fontSize: 11 }} />
                    </ActionButton>
                ) : (
                    <ActionButton $token={token} title={t('session.actions.resume')} onClick={(e) => { e.stopPropagation(); onResume() }}>
                        <PlayCircleOutlined style={{ fontSize: 11 }} />
                    </ActionButton>
                )}
                <ActionButton $token={token} $danger title={t('session.actions.delete')} onClick={(e) => { e.stopPropagation(); onDelete() }}>
                    <DeleteOutlined style={{ fontSize: 11 }} />
                </ActionButton>
                {extraAction}
            </SessionActions>
        </SessionItem>
    )
}
