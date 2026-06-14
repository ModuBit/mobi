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

import React, { useState, useMemo, useCallback, useEffect, type ReactNode } from 'react'
import { App, Badge, Input, Modal, Tooltip, message as messageApi, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FolderClosed, FolderOpen, SquarePen } from 'lucide-react'
import { EditOutlined, InboxOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { useGroupSessions } from '@/core/data/hooks/queries/useGroupSessions'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import type { StatusStyle } from '@/components/pixel-avatar/types'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'
import { getSessionAvatarStatus, extractFolderName } from '@/core/utils/sessionStatus'

const { useToken } = antTheme

/** 默认展示和每次加载更多的会话数 */
const PAGE_SIZE = 5

const AVATAR_STYLES: Partial<Record<string, StatusStyle>> = {}

// ========== 样式组件 ==========

// 整体容器
const Container = styled.div`
    display: flex;
    flex-direction: column;
    padding: 4px 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
`

// 分区标题
const SectionTitle = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    padding: 8px 8px 4px;
    font-size: 13px;
    font-weight: 500;
    color: ${props => props.$token.colorTextQuaternary};
`

// 项目分组容器
const GroupContainer = styled.div`
    margin-bottom: 4px;
`

// 项目头：文件夹图标 + 名称
const GroupHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
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

    /* 新建会话按钮：默认隐藏，hover 时显示 */
    .new-session-btn {
        display: none;
    }
    &:hover .new-session-btn {
        display: inline-flex;
    }
`

// 新建会话按钮（hover 时通过 GroupHeader 的 CSS 显示）
const NewSessionButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
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
const FolderIcon = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: inline-flex;
    font-size: 14px;
    color: ${props => props.$token.colorTextTertiary};
`

// 项目名称
const GroupName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 会话列表动画容器（grid-row 高度动画）
const SessionListWrapper = styled.div<{ $expanded: boolean }>`
    display: grid;
    grid-template-rows: ${props => props.$expanded ? '1fr' : '0fr'};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: grid-template-rows 0.2s ease, opacity 0.15s ease;
`

// 会话列表内容（overflow hidden 配合 grid 动画）
const SessionListInner = styled.div`
    overflow: hidden;
`

// 会话列表
const SessionListContainer = styled.div`
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 0;
`

// 单个会话项
const SessionItem = styled.div<{
    $active: boolean
    $token: ReturnType<typeof useToken>['token']
}>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 8px 0 26px;
    border: none;
    background: ${props => props.$active ? props.$token.colorPrimaryBg : 'transparent'};
    color: ${props => props.$active ? props.$token.colorPrimaryText : props.$token.colorText};
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
const SessionName = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 相对时间
const TimeLabel = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex-shrink: 0;
    font-size: 11px;
    color: ${props => props.$token.colorTextQuaternary};
    white-space: nowrap;
`

// 操作按钮组
const SessionActions = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
`

// 单个操作按钮
const ActionButton = styled.button<{ $token: ReturnType<typeof useToken>['token']; $danger?: boolean }>`
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
const RenameRow = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
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

// "展开显示" 链接
const ShowMoreLink = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: block;
    width: 100%;
    padding: 4px 8px 4px 30px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: color 0.15s;

    &:hover {
        color: ${props => props.$token.colorPrimary};
    }
`

/** 从 session metadata 中取显示名称（用于重命名初始值） */
function getSessionName(session: Session): string {
    const metadata = session.metadata as SessionMetadataSummary | undefined
    return metadata?.name || ''
}

// ========== 会话行组件 ==========

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
}

function SessionRow({
    session, active, isRenaming,
    renameValue, onRenameValueChange, onRenameConfirm, onRenameCancel, onRenameLoading,
    onClick, onRename, onArchive, onResume, onDelete,
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
            <PixelAvatar name={session.id} status={avatarStatus} size={18} statusStyles={AVATAR_STYLES} />
            <Tooltip title={displayName} mouseEnterDelay={0.5} placement="right">
                <SessionName>{displayName}</SessionName>
            </Tooltip>
            {hasUnread && <Badge data-testid={`session-id-badge-${session.id}`} color="#fa541c" dot />}
            <TimeLabel $token={token} className="session-time">{relativeTime}</TimeLabel>
            <SessionActions className="session-actions">
                <ActionButton $token={token} title={t('session.actions.rename')} onClick={(e) => { e.stopPropagation(); onRename() }}>
                    <EditOutlined style={{ fontSize: 11 }} />
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
            </SessionActions>
        </SessionItem>
    )
}

// ========== 项目分组组件 ==========

interface ProjectGroupProps {
    groupKey: string
    activeSessionId: string | undefined
    renamingSessionId: string | null
    renameValue: string
    setRenameValue: (v: string) => void
    onRenameConfirm: (sessionId: string) => void
    onRenameCancel: () => void
    onArchive: (session: Session) => void
    onResume: (session: Session) => void
    onDelete: (session: Session) => void
    onRenameStart: (sessionId: string, currentName: string) => void
    renameLoading: boolean
}

/**
 * 单个项目分组
 * 自动展开包含当前活跃会话的分组，其余折叠
 */
function ProjectGroup({
    groupKey, activeSessionId,
    renamingSessionId, renameValue, setRenameValue,
    onRenameConfirm, onRenameCancel, onArchive, onResume, onDelete, onRenameStart,
    renameLoading,
}: ProjectGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

    // 获取该分组下的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const { data: groupSessionsPages } = useGroupSessions(groupKey)
    // 从全局会话缓存获取完整 Session 数据
    const { data: allSessions } = useSessions()

    // 从全局缓存中查找当前分组的会话
    const sessions = useMemo<Session[]>(() => {
        if (!groupSessionsPages?.pages || !allSessions) return []

        const sessionIdSet = new Set<string>()
        for (const page of groupSessionsPages.pages) {
            for (const id of page.sessionIds) {
                sessionIdSet.add(id)
            }
        }

        return allSessions
            .filter(s => sessionIdSet.has(s.id))
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }, [groupSessionsPages?.pages, allSessions])

    // 判断当前分组是否包含活跃会话 → 决定默认展开状态
    const containsActive = useMemo(() => {
        return !!activeSessionId && sessions.some(s => s.id === activeSessionId)
    }, [activeSessionId, sessions])

    // 展开状态：用户可自由折叠/展开
    const [expanded, setExpanded] = useState(false)

    // 当数据加载后发现包含活跃会话，自动展开（仅首次触发）
    const [autoExpanded, setAutoExpanded] = useState(false)
    useEffect(() => {
        if (containsActive && !autoExpanded) {
            setExpanded(true)
            setAutoExpanded(true)
        }
    }, [containsActive, autoExpanded])

    const folderName = extractFolderName(groupKey)

    // 从该分组下的 session metadata 中提取完整项目路径
    const fullProjectPath = useMemo(() => {
        for (const s of sessions) {
            const path = (s.metadata as { path?: string } | undefined)?.path
            if (path) return path
        }
        // 无 session 时 fallback 到 groupKey（截断路径，不保证正确）
        return groupKey
    }, [sessions, groupKey])

    // 可见会话列表（折叠时限制数量）
    const visibleSessions = sessions.slice(0, visibleCount)
    const hasMore = sessions.length > visibleCount

    const handleSessionClick = useCallback((sessionId: string) => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }, [navigate])

    const handleHeaderClick = useCallback(() => {
        setExpanded(prev => !prev)
    }, [])

    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        navigate({ to: '/sessions/new', search: { cwd: fullProjectPath } })
    }, [navigate, fullProjectPath])

    return (
        <GroupContainer>
            <GroupHeader $token={token} onClick={handleHeaderClick}>
                <FolderIcon $token={token}>
                    {expanded ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
                </FolderIcon>
                <GroupName>{folderName}</GroupName>
                <NewSessionButton $token={token} className="new-session-btn" onClick={handleNewSession}>
                    <SquarePen size={13} />
                </NewSessionButton>
            </GroupHeader>
            <SessionListWrapper $expanded={expanded && sessions.length > 0}>
                <SessionListInner>
                    <SessionListContainer>
                        {visibleSessions.map(session => (
                            <SessionRow
                                key={session.id}
                                session={session}
                                active={session.id === activeSessionId}
                                isRenaming={renamingSessionId === session.id}
                                renameValue={renameValue}
                                onRenameValueChange={setRenameValue}
                                onRenameConfirm={() => onRenameConfirm(session.id)}
                                onRenameCancel={onRenameCancel}
                                onRenameLoading={renameLoading}
                                onClick={() => handleSessionClick(session.id)}
                                onRename={() => onRenameStart(session.id, getSessionName(session))}
                                onArchive={() => onArchive(session)}
                                onResume={() => onResume(session)}
                                onDelete={() => onDelete(session)}
                            />
                        ))}
                        {hasMore && (
                            <ShowMoreLink
                                $token={token}
                                onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                            >
                                {t('nav.showMore', { count: sessions.length - visibleCount })}
                            </ShowMoreLink>
                        )}
                    </SessionListContainer>
                </SessionListInner>
            </SessionListWrapper>
        </GroupContainer>
    )
}

// ========== 主组件 ==========

/**
 * 侧边栏项目分组会话列表
 * 按工作目录分组展示，参照 Codex 风格：文件夹图标 + 项目名 + 简洁会话列表
 */
export function SidebarProjects() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { message: messageApi } = App.useApp()
    const queryClient = useQueryClient()
    const authToken = useAuthStore((s) => s.token)
    const api = useMobiApi(authToken)
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // 重命名状态
    const { startRename, renamingSessionId, renameValue, setRenameValue, cancelRename } = useUiStore()
    const renameActions = useSessionActions(renamingSessionId)

    // 使缓存失效
    const invalidateAll = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionGroups }),
            queryClient.invalidateQueries({ queryKey: ['groupSessions'] }),
        ])
    }, [queryClient])

    // 确认重命名
    const handleRenameConfirm = useCallback(async (sessionId: string) => {
        if (!renameValue.trim() || !renamingSessionId) {
            messageApi.error(t('session.actions.nameRequired'))
            return
        }
        try {
            await renameActions.renameSession(renameValue.trim())
            messageApi.success(t('common.success'))
            await invalidateAll(renamingSessionId)
            cancelRename()
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [renameValue, renamingSessionId, renameActions, t, invalidateAll, cancelRename, messageApi])

    // 退出会话
    const handleArchive = useCallback(async (session: Session) => {
        try {
            await api.sessions.archive(session.id)
            messageApi.success(t('common.success'))
            await invalidateAll(session.id)
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [api, t, invalidateAll, messageApi])

    // 恢复会话（未活跃时），成功后跳转详情页
    const handleResume = useCallback(async (session: Session) => {
        try {
            const res = await api.sessions.resume(session.id)
            messageApi.success(t('common.success'))
            await invalidateAll(session.id)
            navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
        } catch {
            messageApi.error(t('common.error'))
        }
    }, [api, t, invalidateAll, navigate, messageApi])

    // 删除会话
    const handleDelete = useCallback((session: Session) => {
        Modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await api.sessions.delete(session.id)
                    messageApi.success(t('common.success'))
                    queryClient.removeQueries({ queryKey: queryKeys.session(session.id) })
                    queryClient.removeQueries({ queryKey: queryKeys.messages(session.id) })
                    await invalidateAll(session.id)
                    if (activeSessionId === session.id) {
                        navigate({ to: '/sessions' })
                    }
                } catch {
                    messageApi.error(t('common.error'))
                }
            },
        })
    }, [api, t, invalidateAll, queryClient, activeSessionId, navigate, messageApi])

    const { data: groups = [] } = useSessionGroups()

    return (
        <Container>
            <SectionTitle $token={token}>{t('nav.projects')}</SectionTitle>
            {groups.map(group => (
                <ProjectGroup
                    key={group.key}
                    groupKey={group.key}
                    activeSessionId={activeSessionId}
                    renamingSessionId={renamingSessionId}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={cancelRename}
                    onArchive={handleArchive}
                    onResume={handleResume}
                    onDelete={handleDelete}
                    onRenameStart={startRename}
                    renameLoading={renameActions.isPending}
                />
            ))}
        </Container>
    )
}
