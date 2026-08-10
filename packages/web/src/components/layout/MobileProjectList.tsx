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

import { useState, useCallback } from 'react'
import { Button, Drawer, Input, Modal, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FolderClosed, FolderOpen, Plus } from 'lucide-react'
import {
    EditOutlined,
    InboxOutlined,
    DeleteOutlined,
    PlayCircleOutlined,
    MoreOutlined,
    CloseOutlined,
    LoadingOutlined,
} from '@ant-design/icons'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { useProjectGroupSessions } from '@/core/data/hooks/useProjectGroupSessions'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { getSessionAvatarStatus, extractFolderName } from '@/core/utils/sessionStatus'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { useLongPress } from '@/core/data/hooks/useLongPress'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'

const { useToken } = antTheme

// ========== 样式组件 ==========

const Container = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    border-top: 1px solid ${props => props.$token.colorBorderSecondary};
    border-bottom: 1px solid ${props => props.$token.colorBorderSecondary};
    margin: 4px 0;
    padding: 4px 0;
    background: ${props => props.$token.colorBgLayout};
`

// 分区标题行
const SectionHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    padding: 8px 20px 4px;
    font-size: 13px;
    font-weight: 600;
    color: ${props => props.$token.colorTextQuaternary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
`

// 项目头
const GroupHeader = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
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
const FolderIcon = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: inline-flex;
    color: ${props => props.$token.colorTextTertiary};
`

// 项目名称
const GroupName = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    font-size: 15px;
    font-weight: 500;
    color: ${props => props.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 新建会话按钮（常驻可见）
const NewSessionBtn = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
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
const SessionListWrapper = styled.div<{ $expanded: boolean }>`
    display: grid;
    grid-template-rows: ${props => props.$expanded ? '1fr' : '0fr'};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: grid-template-rows 0.2s ease, opacity 0.15s ease;
`

const SessionListInner = styled.div`
    overflow: hidden;
`

// 单个会话项
const SessionItem = styled.div<{ $active: boolean; $token: ReturnType<typeof useToken>['token'] }>`
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
const SessionName = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    font-size: 14px;
    color: ${props => props.$token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

// 相对时间
const TimeLabel = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex-shrink: 0;
    font-size: 12px;
    color: ${props => props.$token.colorTextQuaternary};
    white-space: nowrap;
`

// ⋮ 更多按钮
const MoreButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
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

// 骨架占位 shimmer 动画
const shimmer = keyframes`
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
`

// 会话行骨架（首次加载时占位，行高对齐 SessionItem）
const SkeletonRow = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 12px 0 50px;

    & > .sk-bar {
        height: 10px;
        border-radius: 5px;
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

// 列表底部链接区（收起 / 展开更多 并列）
const ListFooter = styled.div`
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 36px;
    padding: 0 12px 0 50px;
`

// 底部链接（收起、展开更多共用）
const FooterLink = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    font-size: 13px;
    padding: 0;
    cursor: pointer;

    &:active {
        color: ${props => props.$token.colorPrimary};
    }

    &:disabled {
        cursor: default;
        opacity: 0.7;
    }
`

// ========== 单个会话项 ==========

interface MobileSessionItemProps {
    session: Session
    active: boolean
    onClick: () => void
    /** 长按或点击 ⋮ 触发的操作回调 */
    onLongPress: () => void
}

/**
 * 单个会话项
 * 支持点击导航、长按弹出操作菜单（与点击 ⋮ 等效）
 */
function MobileSessionItem({ session, active, onClick, onLongPress }: MobileSessionItemProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const longPress = useLongPress(onLongPress)

    const avatarStatus = getSessionAvatarStatus(session)
    const displayName = getSessionDisplayName(session)
    const relativeTime = formatRelativeTime(session.updatedAt, t)

    return (
        <SessionItem
            $active={active}
            $token={token}
            onClick={longPress.withClickGuard(onClick)}
            onTouchStart={longPress.onTouchStart}
            onTouchEnd={longPress.onTouchEnd}
            onTouchMove={longPress.onTouchMove}
        >
            <StatusStateIcon state={avatarStatus} style={{ width: 10, height: 10 }} />
            <SessionName $token={token}>{displayName}</SessionName>
            <TimeLabel $token={token}>{relativeTime}</TimeLabel>
            <MoreButton
                $token={token}
                onClick={(e) => { e.stopPropagation(); onLongPress() }}
                aria-label={t('common.more')}
            >
                <MoreOutlined style={{ fontSize: 16 }} />
            </MoreButton>
        </SessionItem>
    )
}

// ========== 项目分组组件 ==========

interface MobileProjectGroupProps {
    groupKey: string
    activeSessionId: string | undefined
    onSessionAction: (sessionId: string) => void
    onCloseMenu: () => void
}

function MobileProjectGroup({
    groupKey, activeSessionId, onSessionAction, onCloseMenu,
}: MobileProjectGroupProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()

    const {
        sessions, visibleSessions, fullProjectPath,
        expanded, toggleExpanded,
        isLoadingInitial, isLoadingMore,
        showCollapse, canShowMore, remainingCount,
        showMore, collapse,
    } = useProjectGroupSessions(groupKey, activeSessionId)

    const folderName = extractFolderName(groupKey)

    const handleNewSession = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        onCloseMenu()
        navigate({ to: '/sessions/new', search: { cwd: fullProjectPath } })
    }, [navigate, fullProjectPath, onCloseMenu])

    const handleSessionClick = useCallback((sessionId: string) => {
        onCloseMenu()
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }, [navigate, onCloseMenu])

    // 展开容器在「有会话」或「正在首次加载」时撑开，避免点了没反馈
    const wrapperExpanded = expanded && (sessions.length > 0 || isLoadingInitial)
    const showSkeleton = isLoadingInitial && sessions.length === 0
    const showFooter = !showSkeleton && (showCollapse || canShowMore || isLoadingMore)

    return (
        <div>
            <GroupHeader $token={token} onClick={toggleExpanded}>
                <FolderIcon $token={token}>
                    {expanded ? <FolderOpen size={18} /> : <FolderClosed size={18} />}
                </FolderIcon>
                <GroupName $token={token}>{folderName}</GroupName>
                <NewSessionBtn $token={token} onClick={handleNewSession} aria-label={t('nav.newSession')}>
                    <Plus size={18} />
                </NewSessionBtn>
            </GroupHeader>
            <SessionListWrapper $expanded={wrapperExpanded}>
                <SessionListInner>
                    {showSkeleton ? (
                        <>
                            <SkeletonRow $token={token}>
                                <span className="sk-bar" style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                                <span className="sk-bar" style={{ flex: 1 }} />
                            </SkeletonRow>
                            <SkeletonRow $token={token}>
                                <span className="sk-bar" style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                                <span className="sk-bar" style={{ flex: 1 }} />
                            </SkeletonRow>
                            <SkeletonRow $token={token}>
                                <span className="sk-bar" style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                                <span className="sk-bar" style={{ flex: 1 }} />
                            </SkeletonRow>
                        </>
                    ) : visibleSessions.map(session => (
                        <MobileSessionItem
                            key={session.id}
                            session={session}
                            active={session.id === activeSessionId}
                            onClick={() => handleSessionClick(session.id)}
                            onLongPress={() => onSessionAction(session.id)}
                        />
                    ))}
                    {showFooter && (
                        <ListFooter>
                            {canShowMore && !isLoadingMore && (
                                <FooterLink $token={token} onClick={showMore}>
                                    {remainingCount > 0
                                        ? t('nav.showMore', { count: remainingCount })
                                        : t('nav.loadMore')}
                                </FooterLink>
                            )}
                            {showCollapse && !isLoadingMore && (
                                <FooterLink $token={token} onClick={collapse}>
                                    {t('nav.collapse')}
                                </FooterLink>
                            )}
                            {isLoadingMore && (
                                <FooterLink $token={token} disabled>
                                    <LoadingOutlined /> {t('common.loading')}
                                </FooterLink>
                            )}
                        </ListFooter>
                    )}
                </SessionListInner>
            </SessionListWrapper>
        </div>
    )
}

// ========== 主组件 ==========

interface MobileProjectListProps {
    /** 关闭菜单 Drawer 的回调 */
    onCloseMenu: () => void
}

/**
 * Mobile 端项目折叠列表
 * 嵌入 MobileMenuDrawer，提供项目浏览和会话操作
 */
export function MobileProjectList({ onCloseMenu }: MobileProjectListProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const api = useMobiApi()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    // ActionSheet 状态
    const [actionSessionId, setActionSessionId] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // 重命名 Modal 状态
    const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')

    const renameActions = useSessionActions(renameSessionId)

    // 获取所有分组
    const { data: groups = [] } = useSessionGroups()
    // 获取所有会话（用于查找 ActionSheet 对应 session）
    const { data: allSessions } = useSessions()

    const findSession = useCallback((sessionId: string): Session | undefined => {
        return allSessions?.find(s => s.id === sessionId)
    }, [allSessions])

    // 使缓存失效
    const invalidateAll = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionGroups }),
            queryClient.invalidateQueries({ queryKey: ['groupSessions'] }),
        ])
    }, [queryClient])

    // 关闭 ActionSheet
    const closeActionSheet = useCallback(() => {
        if (!actionLoading) setActionSessionId(null)
    }, [actionLoading])

    // 重命名
    const handleRenameStart = useCallback(() => {
        if (!actionSessionId) return
        const session = findSession(actionSessionId)
        if (!session) return
        const metadata = session.metadata as SessionMetadataSummary | undefined
        setRenameSessionId(actionSessionId)
        setRenameValue(metadata?.name || '')
        setActionSessionId(null)
    }, [actionSessionId, findSession])

    const handleRenameConfirm = useCallback(async () => {
        if (!renameValue.trim() || !renameSessionId) return
        try {
            await renameActions.renameSession(renameValue.trim())
            await invalidateAll(renameSessionId)
            setRenameSessionId(null)
            setRenameValue('')
        } catch {
            // 错误由 hook 内部处理
        }
    }, [renameValue, renameSessionId, renameActions, invalidateAll])

    const handleRenameCancel = useCallback(() => {
        setRenameSessionId(null)
        setRenameValue('')
    }, [])

    // 归档
    const handleArchive = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('archive')
        try {
            await api.sessions.archive(actionSessionId)
            await invalidateAll(actionSessionId)
            setActionSessionId(null)
        } catch {
            // ignore
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, invalidateAll])

    // 恢复
    const handleResume = useCallback(async () => {
        if (!actionSessionId) return
        setActionLoading('resume')
        try {
            const res = await api.sessions.resume(actionSessionId)
            await invalidateAll(actionSessionId)
            setActionSessionId(null)
            onCloseMenu()
            navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
        } catch {
            // ignore
        } finally {
            setActionLoading(null)
        }
    }, [actionSessionId, api, invalidateAll, onCloseMenu, navigate])

    // 删除
    const handleDelete = useCallback(() => {
        if (!actionSessionId) return
        const sessionId = actionSessionId
        setActionLoading('delete')
        Modal.confirm({
            title: t('session.actions.deleteConfirmTitle'),
            content: t('session.actions.deleteConfirmContent'),
            okText: t('common.confirm'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    await api.sessions.delete(sessionId)
                    queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
                    clearMessageWindow(sessionId)
                    await invalidateAll(sessionId)
                    // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
                    clearSessionResources(sessionId)
                    setActionSessionId(null)
                    if (activeSessionId === sessionId) {
                        onCloseMenu()
                        navigate({ to: '/sessions' })
                    }
                } catch {
                    // ignore
                } finally {
                    setActionLoading(null)
                }
            },
            onCancel: () => {
                setActionLoading(null)
            },
        })
    }, [actionSessionId, api, queryClient, invalidateAll, activeSessionId, onCloseMenu, navigate, t])

    // ActionSheet 当前操作的 session
    const actionSession = actionSessionId ? findSession(actionSessionId) : null

    return (
        <>
            <Container $token={token}>
                <SectionHeader $token={token}>{t('nav.projects')}</SectionHeader>
                {groups.map(group => (
                    <MobileProjectGroup
                        key={group.key}
                        groupKey={group.key}
                        activeSessionId={activeSessionId}
                        onSessionAction={setActionSessionId}
                        onCloseMenu={onCloseMenu}
                    />
                ))}
            </Container>

            {/* ActionSheet：会话操作菜单（重命名 / 归档·恢复 / 删除 / 取消）
                ⚠️ 故意使用 antd 原生 Drawer，**不要改成 MobileDrawer**。
                这是轻量操作菜单：内容固定（几个按钮）、高度低、用完即关，
                不需要 MobileDrawer 的下拉关闭手势、拖拽指示条、85dvh maxHeight。
                title 显示当前操作的 session 名称（getSessionDisplayName），让用户
                明确知道正在修改哪个会话 */}
            <Drawer
                placement="bottom"
                open={!!actionSessionId}
                onClose={closeActionSheet}
                title={actionSession ? getSessionDisplayName(actionSession) : undefined}
                closable={false}
                styles={{ body: { padding: '8px 0 max(24px, env(safe-area-inset-bottom))' } }}
            >
                {actionSession && (
                    <>
                        {/* 重命名 */}
                        <Button
                            type="text"
                            block
                            icon={<EditOutlined />}
                            disabled={!!actionLoading}
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={handleRenameStart}
                        >
                            {t('session.actions.rename')}
                        </Button>

                        {/* 归档 / 恢复 */}
                        {actionSession.active ? (
                            <Button
                                type="text"
                                block
                                icon={<InboxOutlined />}
                                disabled={!!actionLoading}
                                loading={actionLoading === 'archive'}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleArchive}
                            >
                                {t('session.actions.archive')}
                            </Button>
                        ) : (
                            <Button
                                type="text"
                                block
                                icon={<PlayCircleOutlined />}
                                disabled={!!actionLoading}
                                loading={actionLoading === 'resume'}
                                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                                onClick={handleResume}
                            >
                                {t('session.actions.resume')}
                            </Button>
                        )}

                        <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 16px' }} />

                        {/* 删除 */}
                        <Button
                            type="text"
                            block
                            danger
                            icon={<DeleteOutlined />}
                            disabled={actionSession.active || !!actionLoading}
                            loading={actionLoading === 'delete'}
                            style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                            onClick={handleDelete}
                        >
                            {t('session.actions.delete')}
                        </Button>

                        <div style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 16px' }} />

                        {/* 取消 */}
                        <Button
                            type="text"
                            block
                            icon={<CloseOutlined />}
                            disabled={!!actionLoading}
                            style={{ height: 48, justifyContent: 'center', color: token.colorTextSecondary }}
                            onClick={closeActionSheet}
                        >
                            {t('common.cancel')}
                        </Button>
                    </>
                )}
            </Drawer>

            {/* 重命名 Modal */}
            <Modal
                title={t('session.actions.rename')}
                open={!!renameSessionId}
                onOk={handleRenameConfirm}
                onCancel={handleRenameCancel}
                confirmLoading={renameActions.isPending}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                destroyOnClose
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameConfirm}
                    placeholder={t('session.actions.rename')}
                    autoFocus
                />
            </Modal>
        </>
    )
}
