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
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useSessionGroups } from '@/core/data/hooks/queries/useSessionGroups'
import { useGroupSessions } from '@/core/data/hooks/queries/useGroupSessions'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { SidebarSessionItem } from './SidebarSessionItem'
import type { Session } from '@/core/data/api/types'

const { useToken } = antTheme

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

// 分组标题
const GroupHeader = styled.button<{ $expanded: boolean; $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    font-weight: 500;
    text-align: left;
    transition: all 0.15s;

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
    }
`

// 展开箭头
const Arrow = styled.span<{ $expanded: boolean }>`
    display: inline-flex;
    font-size: 10px;
    transition: transform 0.2s;
    transform: rotate(${props => props.$expanded ? 90 : 0}deg);
`

// 会话列表容器
const SessionList = styled.div<{ $expanded: boolean }>`
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-left: 12px;
    overflow: hidden;
    max-height: ${props => props.$expanded ? 'none' : '0'};
    opacity: ${props => props.$expanded ? 1 : 0};
    transition: opacity 0.15s;
`

// 计数标签
const CountBadge = styled.span<{ $token: ReturnType<typeof useToken>['token'] }>`
    font-size: 10px;
    color: ${props => props.$token.colorTextQuaternary};
    font-weight: 400;
    margin-left: auto;
`

/** 从 group.key 路径提取最后一段目录名 */
function extractFolderName(key: string): string {
    const parts = key.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || key
}

/**
 * 单个项目分组（可折叠面板）
 */
function ProjectGroup({ groupKey, activeSessionId }: {
    groupKey: string
    activeSessionId: string | undefined
}) {
    const { token } = useToken()
    const navigate = useNavigate()
    const [expanded, setExpanded] = useState(false)

    // 获取该分组下的会话 ID 列表
    const { data: groupSessionsPages } = useGroupSessions(expanded ? groupKey : null)
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

    const folderName = extractFolderName(groupKey)

    const handleSessionClick = useCallback((sessionId: string) => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }, [navigate])

    return (
        <div>
            <GroupHeader
                $expanded={expanded}
                $token={token}
                onClick={() => setExpanded(prev => !prev)}
            >
                <Arrow $expanded={expanded}>{'▶'}</Arrow>
                <span>{folderName}</span>
                <CountBadge $token={token}>{sessions.length}</CountBadge>
            </GroupHeader>
            <SessionList $expanded={expanded}>
                {sessions.map(session => (
                    <SidebarSessionItem
                        key={session.id}
                        session={session}
                        active={session.id === activeSessionId}
                        onClick={() => handleSessionClick(session.id)}
                    />
                ))}
            </SessionList>
        </div>
    )
}

/**
 * 侧边栏项目分组会话列表
 * 展示按工作目录分组的会话列表，支持折叠/展开
 */
export function SidebarProjects() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { data: groups = [] } = useSessionGroups()
    const params = useParams({ strict: false })
    const activeSessionId = params.sessionId as string | undefined

    return (
        <Container>
            <SectionTitle $token={token}>{t('nav.projects')}</SectionTitle>
            {groups.map(group => (
                <ProjectGroup
                    key={group.key}
                    groupKey={group.key}
                    activeSessionId={activeSessionId}
                />
            ))}
        </Container>
    )
}
