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

import { useState, useMemo, useCallback } from 'react'
import { Conversations } from '@ant-design/x'
import type { ConversationsProps } from '@ant-design/x'
import { Modal, Input, message, Skeleton, Empty, Badge } from 'antd'
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
} from '@ant-design/icons'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { queryKeys } from '@/lib/query-keys'
import { getSessionDisplayName } from '@/utils/sessionUtils'
import styled from '@emotion/styled'
import type { Session } from '@/api/types'

const ListContainer = styled.div`
    padding: 8px 4px;
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

    // 构建 Conversations items
    const items = useMemo(() => {
        const result: ConversationsProps['items'] = []

        for (let i = 0; i < groupQueries.length; i++) {
            const query = groupQueries[i]
            if (!query.data) continue

            const { sessions, groupKey } = query.data
            const group = groups[i]

            for (const session of sessions) {
                result.push({
                    key: session.id,
                    label: getSessionDisplayName(session),
                    group: group?.name || groupKey,
                    ...(session.active ? { icon: <Badge status="processing" /> } : {}),
                })
            }
        }

        return result
    }, [groupQueries, groups])

    // 默认展开有活跃会话的分组
    const defaultExpandedKeys = useMemo(() => {
        return groups.filter(g => g.activeCount > 0).map(g => g.name)
    }, [groups])

    // 导航到选中会话
    const handleActiveChange = useCallback((key: string) => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId: key } })
    }, [navigate])

    // 查找 session 数据
    const findSession = useCallback((sessionId: string): Session | undefined => {
        for (const query of groupQueries) {
            if (!query.data) continue
            const found = query.data.sessions.find(s => s.id === sessionId)
            if (found) return found
        }
        return undefined
    }, [groupQueries])

    // 重命名状态
    const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const renameActions = useSessionActions(renamingSessionId)

    // 使缓存失效
    const invalidateAll = useCallback(async (sessionId: string) => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        await queryClient.invalidateQueries({ queryKey: ['sessionGroups'] })
        // 精确失效该分组缓存
        await queryClient.invalidateQueries({ queryKey: ['groupSessions'] })
    }, [queryClient])

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
                    setRenamingSessionId(sessionId)
                    const metadata = session.metadata as Record<string, unknown> | undefined
                    setRenameValue((metadata?.name as string) || '')
                },
            })

            menuItems.push({
                key: 'archive',
                icon: <InboxOutlined />,
                label: t('session.actions.archive'),
                onClick: async () => {
                    try {
                        await api.sessions.archive(sessionId)
                        message.success(t('common.success'))
                        invalidateAll(sessionId)
                    } catch {
                        message.error(t('common.error'))
                    }
                },
            })

            menuItems.push({ type: 'divider' as const })

            // 已结束的会话可恢复
            if (!session.active) {
                menuItems.push({
                    key: 'resume',
                    icon: <PlayCircleOutlined />,
                    label: t('session.actions.resume'),
                    onClick: async () => {
                        try {
                            const res = await api.sessions.resume(sessionId)
                            message.success(t('common.success'))
                            await invalidateAll(sessionId)
                            navigate({ to: '/sessions/$sessionId', params: { sessionId: res.data.sessionId } })
                        } catch {
                            message.error(t('common.error'))
                        }
                    },
                })
            }

            // 活跃会话可中断和切换模式
            if (session.active) {
                menuItems.push({
                    key: 'abort',
                    icon: <StopOutlined />,
                    label: t('session.actions.abort'),
                    danger: true,
                    onClick: async () => {
                        try {
                            await api.sessions.abort(sessionId)
                            message.success(t('common.success'))
                            invalidateAll(sessionId)
                        } catch {
                            message.error(t('common.error'))
                        }
                    },
                })

                menuItems.push({
                    key: 'switch',
                    icon: <SwapOutlined />,
                    label: t('session.actions.switch'),
                    onClick: async () => {
                        try {
                            await api.sessions.switch(sessionId)
                            message.success(t('common.success'))
                            invalidateAll(sessionId)
                        } catch {
                            message.error(t('common.error'))
                        }
                    },
                })
            }

            menuItems.push({ type: 'divider' as const })

            menuItems.push({
                key: 'delete',
                icon: <DeleteOutlined />,
                label: t('session.actions.delete'),
                danger: true,
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
                                navigate({ to: '/sessions' })
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
    }, [findSession, t, api, navigate, invalidateAll, queryClient])

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
            setRenamingSessionId(null)
        } catch {
            message.error(t('common.error'))
        }
    }, [renameValue, renamingSessionId, renameActions, t, invalidateAll])

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
            <ListContainer>
                <Conversations
                    items={items}
                    activeKey={selectedSessionId}
                    onActiveChange={handleActiveChange}
                    groupable={{
                        collapsible: true,
                        defaultExpandedKeys,
                    }}
                    menu={menu}
                    style={{ height: '100%' }}
                />
            </ListContainer>

            {/* 重命名弹窗 */}
            <Modal
                title={t('session.actions.rename')}
                open={!!renamingSessionId}
                onOk={handleRenameConfirm}
                onCancel={() => setRenamingSessionId(null)}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                confirmLoading={renameActions.isPending}
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder={t('session.actions.namePlaceholder')}
                    onPressEnter={handleRenameConfirm}
                    autoFocus
                />
            </Modal>
        </>
    )
}
