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

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Conversations } from '@ant-design/x'
import type { ConversationsProps } from '@ant-design/x'
import { Modal, Input, message, Skeleton, Empty, Button, Drawer, Badge } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
    EditOutlined,
    DeleteOutlined,
    InboxOutlined,
    PlayCircleOutlined,
    CloseOutlined,
    MoreOutlined,
} from '@ant-design/icons'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useMobiApi } from '@/core/data/api/client'
import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { queryKeys } from '@/core/lib/query-keys'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import { getSessionAvatarStatus } from '@/core/utils/sessionStatus'
import { StatusStateIcon } from '@/components/tool-card/toolIcons'
import { useUiStore } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { mergeSessions } from '@/core/data/cache/sessionCache'
import styled from '@emotion/styled'
import type { Session, SessionMetadataSummary } from '@/core/data/api/types'

const ListContainer = styled.div`
    flex: 1;
    overflow-y: auto;
`

const EmptyContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
`

interface SessionListProps {
    selectedSessionId?: string
}

// 会话操作 loading key 类型
type SessionActionKey = 'resume' | 'archive' | 'delete'

// ActionSheet 菜单项类型
type ActionSheetItem =
    | { type: 'divider' }
    | {
        key: string
        icon: React.ReactNode
        label: string
        danger?: boolean
        disabled?: boolean
        onClick: () => void
    }

// 共享操作上下文
interface ActionContext {
    setLoadingKey: (key: SessionActionKey | null) => void
    onSuccess: () => void
}

/**
 * 会话列表组件
 * 使用 Ant Design X Conversations 组件实现
 */
export function SessionList({ selectedSessionId }: SessionListProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const { setSessionListDrawerOpen, startRename, renamingSessionId, renameValue, setRenameValue, cancelRename } = useUiStore()
    const isMobile = useIsMobile()

    // ActionSheet 状态
    const [actionSheetSessionId, setActionSheetSessionId] = useState<string | null>(null)
    const [actionSheetLoadingKey, setActionSheetLoadingKey] = useState<SessionActionKey | null>(null)
    // PC 菜单 loading 状态
    const [, setMenuLoadingKey] = useState<SessionActionKey | null>(null)
    // 长按相关
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTouchedKey = useRef<string | null>(null)

    // 长按 timer 清理
    useEffect(() => {
        return () => {
            if (longPressTimer.current) clearTimeout(longPressTimer.current)
        }
    }, [])

    // 获取分组列表
    const { data: groups = [], isLoading: groupsLoading } = useSessionGroups()

    // 并行获取所有分组的会话
    const groupQueries = useQueries({
        queries: groups.map(group => ({
            queryKey: queryKeys.groupSessions(group.key),
            queryFn: async () => {
                const res = await api.sessionGroups.getSessions(group.key, undefined, 100)

                // upsert 到全局 sessions 缓存
                queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
                    mergeSessions(old, res.data.sessions)
                )

                return { sessionIds: res.data.sessions.map(s => s.id), groupKey: group.key }
            },
            enabled: !!group.key,
        })),
    })

    // 从全局 sessions 缓存获取完整数据
    const { data: allSessions } = useSessions()

    // 使缓存失效
    const invalidateAll = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessionGroups }),
            queryClient.invalidateQueries({ queryKey: ['groupSessions'] }),
        ])
    }, [queryClient])

    const renameActions = useSessionActions(renamingSessionId)

    // 订阅未读角标 Map —— 角标变化时触发组件重渲染并重算 items
    const badges = useNotificationBadgeStore((s) => s.badges)

    // 确认重命名
    const handleRenameConfirm = useCallback(async () => {
        if (!renameValue.trim() || !renamingSessionId) {
            message.error(t('session.actions.nameRequired'))
            return
        }
        try {
            await renameActions.renameSession(renameValue.trim())
            message.success(t('common.success'))
            await invalidateAll(renamingSessionId)
            cancelRename()
        } catch {
            message.error(t('common.error'))
        }
    }, [renameValue, renamingSessionId, renameActions, t, invalidateAll, cancelRename])

    // 构建 Conversations items
    const items = useMemo(() => {
        const result: ConversationsProps['items'] = []

        // 构建 id → session 查找表，避免嵌套循环中 O(n) 的 find 调用
        const sessionMap = new Map(allSessions?.map(s => [s.id, s]))

        for (let i = 0; i < groupQueries.length; i++) {
            const query = groupQueries[i]
            if (!query.data) continue

            const { sessionIds, groupKey } = query.data
            const group = groups[i]

            for (const sessionId of sessionIds) {
                const session = sessionMap.get(sessionId)
                if (!session) continue

                const isRenaming = renamingSessionId === session.id
                // 该 session 是否有未读角标（ready 或 permission 任一为 true）
                const sessionBadge = badges.get(session.id)
                const hasUnread = Boolean(sessionBadge && (sessionBadge.ready || sessionBadge.permission))
                result.push({
                    key: session.id,
                    label: isRenaming
                        ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                            <Input
                                size="small"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onPressEnter={handleRenameConfirm}
                                onKeyDown={(e) => { if (e.key === 'Escape') cancelRename() }}
                                autoFocus
                                style={{ flex: 1 }}
                            />
                            <Button size="small" type="primary" onClick={handleRenameConfirm} loading={renameActions.isPending}>
                                {t('common.confirm')}
                            </Button>
                            <Button size="small" onClick={cancelRename}>
                                {t('common.cancel')}
                            </Button>
                        </div>
                        : isMobile
                            ? <div data-session-id={session.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {getSessionDisplayName(session)}
                                </span>
                                {hasUnread && <Badge data-testid={`session-id-badge-${session.id}`} color="#fa541c" dot />}
                                <MoreOutlined
                                    style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 14, padding: '8px 4px', cursor: 'pointer', flexShrink: 0 }}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setActionSheetSessionId(session.id)
                                    }}
                                />
                            </div>
                            : <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {getSessionDisplayName(session)}
                                </span>
                                {hasUnread && <Badge data-testid={`session-id-badge-${session.id}`} color="#fa541c" dot />}
                            </div>,
                    group: group?.name || groupKey,
                    icon: <StatusStateIcon state={getSessionAvatarStatus(session)} style={{ width: 10, height: 10 }} />,
                })
            }
        }

        return result
    }, [groupQueries, groups, allSessions, renamingSessionId, renameValue, setRenameValue, handleRenameConfirm, cancelRename, isMobile, setActionSheetSessionId, badges])

    // 默认展开有活跃会话的分组
    const defaultExpandedKeys = useMemo(() => {
        return groups.filter(g => g.activeCount > 0).map(g => g.name)
    }, [groups])

    // 导航到选中会话
    const handleActiveChange = useCallback((key: string) => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId: key } })
        setSessionListDrawerOpen(false)
    }, [navigate, setSessionListDrawerOpen])

    // 查找 session 数据
    const findSession = useCallback((sessionId: string): Session | undefined => {
        return allSessions?.find(s => s.id === sessionId)
    }, [allSessions])

    // 从 session metadata 中提取显示名称
    const getSessionName = useCallback((session: Session) => {
        const metadata = session.metadata as SessionMetadataSummary | undefined
        return metadata?.name || ''
    }, [])

    // 构建共享的操作项（PC 和移动端复用）
    const buildActionItems = useCallback((
        sessionId: string,
        session: Session,
        ctx: ActionContext,
    ): ActionSheetItem[] => {
        const items: ActionSheetItem[] = []

        items.push({
            key: 'rename',
            icon: <EditOutlined />,
            label: t('session.actions.rename'),
            onClick: () => {
                startRename(sessionId, getSessionName(session))
                ctx.onSuccess()
            },
        })

        items.push({
            key: 'archive',
            icon: <InboxOutlined />,
            label: t('session.actions.archive'),
            disabled: !session.active,
            onClick: async () => {
                ctx.setLoadingKey('archive')
                try {
                    await api.sessions.archive(sessionId)
                    message.success(t('common.success'))
                    await invalidateAll(sessionId)
                    ctx.onSuccess()
                    setSessionListDrawerOpen(false)
                } catch {
                    message.error(t('common.error'))
                } finally {
                    ctx.setLoadingKey(null)
                }
            },
        })

        items.push({ type: 'divider' as const })

        items.push({
            key: 'delete',
            icon: <DeleteOutlined />,
            label: t('session.actions.delete'),
            danger: true,
            disabled: session.active,
            onClick: () => {
                ctx.setLoadingKey('delete')
                Modal.confirm({
                    title: t('session.actions.deleteConfirmTitle'),
                    content: t('session.actions.deleteConfirmContent'),
                    okText: t('common.confirm'),
                    okButtonProps: { danger: true },
                    cancelText: t('common.cancel'),
                    onOk: async () => {
                        try {
                            await api.sessions.delete(sessionId)
                            message.success(t('common.success'))
                            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
                            clearMessageWindow(sessionId)
                            await invalidateAll(sessionId)
                            // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
                            clearSessionResources(sessionId)
                            ctx.onSuccess()
                            if (selectedSessionId === sessionId) {
                                navigate({ to: '/sessions' })
                            }
                            setSessionListDrawerOpen(false)
                        } catch {
                            message.error(t('common.error'))
                        } finally {
                            ctx.setLoadingKey(null)
                        }
                    },
                    onCancel: () => {
                        ctx.setLoadingKey(null)
                    },
                })
            },
        })

        return items
    }, [t, api, invalidateAll, queryClient, navigate, getSessionName, startRename, selectedSessionId, setSessionListDrawerOpen])

    // PC 端菜单配置
    const menu: ConversationsProps['menu'] = useCallback((conversation: Record<string, unknown>) => {
        const sessionId = conversation.key as string
        const session = findSession(sessionId)
        if (!session) return { items: [] }

        const ctx: ActionContext = {
            setLoadingKey: setMenuLoadingKey,
            onSuccess: () => {},
        }
        return { items: buildActionItems(sessionId, session, ctx) }
    }, [findSession, buildActionItems])

    // 移动端 ActionSheet 操作项
    const getActionSheetItems = useCallback((sessionId: string) => {
        const session = findSession(sessionId)
        if (!session) return []

        const ctx: ActionContext = {
            setLoadingKey: setActionSheetLoadingKey,
            onSuccess: () => setActionSheetSessionId(null),
        }

        const items: ActionSheetItem[] = []

        // 未激活会话可恢复（仅移动端）
        if (!session.active) {
            items.push({
                key: 'resume',
                icon: <PlayCircleOutlined />,
                label: t('session.actions.resume'),
                onClick: async () => {
                    setActionSheetLoadingKey('resume')
                    try {
                        const res = await api.sessions.resume(sessionId)
                        message.success(t('common.success'))
                        await invalidateAll(sessionId)
                        setActionSheetSessionId(null)
                        navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
                        setSessionListDrawerOpen(false)
                    } catch {
                        message.error(t('common.error'))
                    } finally {
                        setActionSheetLoadingKey(null)
                    }
                },
            })
        }

        return [...items, ...buildActionItems(sessionId, session, ctx)]
    }, [findSession, t, api, invalidateAll, navigate, buildActionItems])

    // 移动端长按事件处理
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        const el = (e.target as HTMLElement).closest('[class*="ant-conversations-item"]') as HTMLElement | null
        if (!el) return

        const sessionId = el.querySelector('[data-session-id]')?.getAttribute('data-session-id')
        if (!sessionId) return

        lastTouchedKey.current = sessionId
        longPressTimer.current = setTimeout(() => {
            if (lastTouchedKey.current) {
                setActionSheetSessionId(lastTouchedKey.current)
            }
        }, 500)
    }, [setActionSheetSessionId])

    const handleTouchEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
        }
        lastTouchedKey.current = null
    }, [])

    // ActionSheet 菜单项
    const actionSheetItems = actionSheetSessionId ? getActionSheetItems(actionSheetSessionId) : []

    // 加载状态
    if (groupsLoading) {
        return <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 16 }} />
    }

    if (items.length === 0) {
        return (
            <EmptyContainer>
                <Empty description={t('session.empty')} />
            </EmptyContainer>
        )
    }

    return (
        <>
            <ListContainer
                onTouchStart={isMobile ? handleTouchStart : undefined}
                onTouchEnd={isMobile ? handleTouchEnd : undefined}
                onTouchMove={isMobile ? handleTouchEnd : undefined}
            >
                <Conversations
                    items={items}
                    activeKey={selectedSessionId}
                    onActiveChange={handleActiveChange}
                    groupable={{
                        collapsible: true,
                        defaultExpandedKeys,
                    }}
                    menu={isMobile ? undefined : menu}
                    style={{ height: '100%' }}
                    styles={{
                        root: { padding: '4px 8px' },
                        item: { paddingInline: 8 },
                    }}
                />
            </ListContainer>

            {/* 移动端 ActionSheet */}
            {isMobile && (
                <Drawer
                    placement="bottom"
                    open={!!actionSheetSessionId}
                    onClose={() => { if (!actionSheetLoadingKey) setActionSheetSessionId(null) }}
                    closable={false}
                    rootClassName="action-sheet-drawer"
                    styles={{
                        body: { padding: '8px 0' },
                    }}
                >
                    {actionSheetItems.map((item, index) =>
                        'type' in item ? (
                            <div key={`divider-${index}`} style={{ height: 1, background: 'var(--ant-color-border-secondary)', margin: '4px 16px' }} />
                        ) : (
                            <Button
                                key={item.key}
                                type="text"
                                block
                                icon={item.icon}
                                disabled={item.disabled || !!actionSheetLoadingKey}
                                danger={item.danger}
                                loading={actionSheetLoadingKey === item.key}
                                style={{
                                    height: 48,
                                    justifyContent: 'flex-start',
                                    paddingInline: 20,
                                    color: item.danger ? 'var(--ant-color-error)' : undefined,
                                }}
                                onClick={item.onClick}
                            >
                                {item.label}
                            </Button>
                        )
                    )}
                    <div style={{ height: 1, background: 'var(--ant-color-border-secondary)', margin: '4px 16px' }} />
                    <Button
                        type="text"
                        block
                        icon={<CloseOutlined />}
                        disabled={!!actionSheetLoadingKey}
                        style={{ height: 48, justifyContent: 'center', color: 'var(--ant-color-text-secondary)' }}
                        onClick={() => setActionSheetSessionId(null)}
                    >
                        {t('common.cancel')}
                    </Button>
                </Drawer>
            )}
        </>
    )
}
