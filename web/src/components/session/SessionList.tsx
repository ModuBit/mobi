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

import { useState, useMemo, useCallback, useRef } from 'react'
import { Conversations } from '@ant-design/x'
import type { ConversationsProps } from '@ant-design/x'
import { Modal, Input, message, Skeleton, Empty, Drawer, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
    EditOutlined,
    DeleteOutlined,
    InboxOutlined,
    StopOutlined,
    PlayCircleOutlined,
    SwapOutlined,
    CloseOutlined,
    MoreOutlined,
} from '@ant-design/icons'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { queryKeys } from '@/lib/query-keys'
import { getSessionDisplayName } from '@/utils/sessionUtils'
import { PixelAvatar } from '@/components/PixelAvatar/PixelAvatar'
import type { AgentStatus, StatusStyle } from '@/components/PixelAvatar/types'
import { useUiStore } from '@/stores/uiStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import styled from '@emotion/styled'
import type { Session } from '@/api/types'

/**
 * 根据 session 状态推导头像状态
 * - inactive: 未激活
 * - awaiting_auth: 等待用户授权
 * - outputting: 输出中（thinking）
 * - idle: 已输出，等待用户输入
 */
function getSessionAvatarStatus(session: Session): AgentStatus {
    if (!session.active) return 'inactive'
    const pendingRequests = session.agentState?.requests
    if (pendingRequests && Object.keys(pendingRequests).length > 0) return 'awaiting_auth'
    if (session.thinking) return 'outputting'
    return 'idle'
}

// Session 列表中的头像样式：默认已无边框，使用默认动画即可
const SESSION_AVATAR_STYLES: Partial<Record<AgentStatus, StatusStyle>> = {}

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

/**
 * 会话列表组件
 * 使用 Ant Design X Conversations 组件实现
 */
export function SessionList({ selectedSessionId }: SessionListProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)
    const queryClient = useQueryClient()
    const { setSessionListDrawerOpen, startRename, renamingSessionId, renameValue, setRenameValue, cancelRename } = useUiStore()
    const isMobile = useIsMobile()

    // 长按 ActionSheet 状态
    const [actionSheetSessionId, setActionSheetSessionId] = useState<string | null>(null)
    const [actionSheetLoadingKey, setActionSheetLoadingKey] = useState<string | null>(null)
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTouchedKey = useRef<string | null>(null)

    // 获取分组列表
    const { data: groups = [], isLoading: groupsLoading } = useSessionGroups()

    // 并行获取所有分组的会话
    const groupQueries = useQueries({
        queries: groups.map(group => ({
            queryKey: ['groupSessions', group.key],
            queryFn: async () => {
                const res = await api.sessionGroups.getSessions(group.key, undefined, 100)
                return { sessions: res.data.sessions as Session[], groupKey: group.key }
            },
            enabled: !!authToken && !!group.key,
        })),
    })

    // 使缓存失效
    const invalidateAll = useCallback(async (sessionId: string) => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        await queryClient.invalidateQueries({ queryKey: ['sessionGroups'] })
        await queryClient.invalidateQueries({ queryKey: ['groupSessions'] })
    }, [queryClient])

    const renameActions = useSessionActions(renamingSessionId)

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

        for (let i = 0; i < groupQueries.length; i++) {
            const query = groupQueries[i]
            if (!query.data) continue

            const { sessions, groupKey } = query.data
            const group = groups[i]

            for (const session of sessions) {
                const isRenaming = renamingSessionId === session.id
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
                                <MoreOutlined
                                    style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 14, padding: '8px 4px', cursor: 'pointer', flexShrink: 0 }}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setActionSheetSessionId(session.id)
                                    }}
                                />
                            </div>
                            : getSessionDisplayName(session),
                    group: group?.name || groupKey,
                    icon: <PixelAvatar name={session.id} status={getSessionAvatarStatus(session)} size={24} statusStyles={SESSION_AVATAR_STYLES} />,
                })
            }
        }

        return result
    }, [groupQueries, groups, renamingSessionId, renameValue, setRenameValue, handleRenameConfirm, cancelRename, isMobile, setActionSheetSessionId])

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
        for (const query of groupQueries) {
            if (!query.data) continue
            const found = query.data.sessions.find(s => s.id === sessionId)
            if (found) return found
        }
        return undefined
    }, [groupQueries])

    // 菜单配置
    const menu: ConversationsProps['menu'] = useCallback((conversation: Record<string, unknown>) => {
        const sessionId = conversation.key as string
        const session = findSession(sessionId)
        if (!session) return { items: [] }

        const buildItems = () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const menuItems: any[] = []

            menuItems.push({
                key: 'rename',
                icon: <EditOutlined />,
                label: t('session.actions.rename'),
                onClick: () => {
                    const metadata = session.metadata as Record<string, unknown> | undefined
                    startRename(sessionId, (metadata?.name as string) || '')
                },
            })

            menuItems.push({
                key: 'archive',
                icon: <InboxOutlined />,
                label: t('session.actions.archive'),
                disabled: !session.active,
                onClick: async () => {
                    try {
                        await api.sessions.archive(sessionId)
                        message.success(t('common.success'))
                        invalidateAll(sessionId)
                        setSessionListDrawerOpen(false)
                    } catch {
                        message.error(t('common.error'))
                    }
                },
            })

            menuItems.push({ type: 'divider' as const })

            menuItems.push({
                key: 'delete',
                icon: <DeleteOutlined />,
                label: t('session.actions.delete'),
                danger: true,
                disabled: session.active,
                onClick: () => {
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
                                queryClient.removeQueries({ queryKey: queryKeys.messages(sessionId) })
                                await invalidateAll(sessionId)
                                if (selectedSessionId === sessionId) {
                                    navigate({ to: '/sessions' })
                                }
                                setSessionListDrawerOpen(false)
                            } catch {
                                message.error(t('common.error'))
                            }
                        },
                    })
                },
            })

            return menuItems
        }

        return { items: buildItems() }
    }, [findSession, t, api, navigate, invalidateAll, queryClient, selectedSessionId, setSessionListDrawerOpen])

    // 移动端：从 session id 获取菜单操作项
    const getActionSheetItems = useCallback((sessionId: string) => {
        const session = findSession(sessionId)
        if (!session) return []

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actions: any[] = []

        actions.push({
            key: 'rename',
            icon: <EditOutlined />,
            label: t('session.actions.rename'),
            onClick: () => {
                setActionSheetSessionId(null)
                const metadata = session.metadata as Record<string, unknown> | undefined
                startRename(sessionId, (metadata?.name as string) || '')
            },
        })

        // 未激活会话可恢复
        if (!session.active) {
            actions.push({
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
                        setActionSheetLoadingKey(null)
                        navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
                        setSessionListDrawerOpen(false)
                    } catch {
                        message.error(t('common.error'))
                        setActionSheetLoadingKey(null)
                    }
                },
            })
        }

        actions.push({
            key: 'archive',
            icon: <InboxOutlined />,
            label: t('session.actions.archive'),
            disabled: !session.active,
            onClick: async () => {
                setActionSheetLoadingKey('archive')
                try {
                    await api.sessions.archive(sessionId)
                    message.success(t('common.success'))
                    await invalidateAll(sessionId)
                    setActionSheetSessionId(null)
                    setActionSheetLoadingKey(null)
                    setSessionListDrawerOpen(false)
                } catch {
                    message.error(t('common.error'))
                    setActionSheetLoadingKey(null)
                }
            },
        })

        actions.push({ type: 'divider' as const })

        actions.push({
            key: 'delete',
            icon: <DeleteOutlined />,
            label: t('session.actions.delete'),
            danger: true,
            disabled: session.active,
            onClick: () => {
                setActionSheetLoadingKey('delete')
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
                            queryClient.removeQueries({ queryKey: queryKeys.messages(sessionId) })
                            await invalidateAll(sessionId)
                            setActionSheetSessionId(null)
                            setActionSheetLoadingKey(null)
                            if (selectedSessionId === sessionId) {
                                navigate({ to: '/sessions' })
                            }
                            setSessionListDrawerOpen(false)
                        } catch {
                            message.error(t('common.error'))
                            setActionSheetLoadingKey(null)
                        }
                    },
                    onCancel: () => {
                        setActionSheetLoadingKey(null)
                    },
                })
            },
        })

        return actions
    }, [findSession, t, api, invalidateAll, queryClient, navigate, startRename, selectedSessionId, setSessionListDrawerOpen])

    // 移动端长按事件处理：通过 data-session-id 属性匹配 session key
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // 从触摸点向上查找 Conversations item 元素
        const el = (e.target as HTMLElement).closest('[class*="ant-conversations-item"]') as HTMLElement | null
        if (!el) return

        // 通过 data-session-id 属性获取 session id
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

    // ActionSheet 中当前 session 的菜单项
    const actionSheetItems = useMemo(() => {
        if (!actionSheetSessionId) return []
        return getActionSheetItems(actionSheetSessionId)
    }, [actionSheetSessionId, getActionSheetItems])

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
                    styles={{
                        wrapper: { height: 'auto', maxHeight: '60vh' },
                        body: { padding: '8px 0', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
                    }}
                >
                    {actionSheetItems.map((item: any) =>
                        item.type === 'divider' ? (
                            <div key="divider" style={{ height: 1, background: 'var(--ant-color-border-secondary)', margin: '4px 16px' }} />
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
