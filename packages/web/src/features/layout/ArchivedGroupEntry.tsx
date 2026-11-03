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

import { useCallback } from 'react'
import { theme as antTheme } from 'antd'
import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from '@tanstack/react-router'
import styled from '@emotion/styled'
import { useArchivedSessions } from '@/core/data/hooks/queries/useArchivedSessions'

const { useToken } = antTheme

/** 侧栏「已归档」入口行（票 05）：「最近」分组之后的唯一一行，带数量徽标 */
const EntryRow = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token']; $active: boolean }>`
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    margin-top: 2px;
    border: none;
    border-radius: var(--radius-control);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    font-weight: 500;
    text-align: left;
    transition: background 0.15s;
    color: ${p => p.$active ? p.$token.colorText : p.$token.colorTextSecondary};
    background: ${p => p.$active ? p.$token.colorBgTextHover : 'transparent'};

    &:hover {
        background: ${p => p.$token.colorBgTextHover};
    }
`

const EntryIcon = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    display: inline-flex;
    font-size: 14px;
    color: ${p => p.$token.colorTextTertiary};
`

const EntryLabel = styled.span`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const EntryCount = styled.span<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    flex-shrink: 0;
    font-size: 11px;
    color: ${p => p.$token.colorTextQuaternary};
    font-variant-numeric: tabular-nums;
`

/**
 * 侧栏「已归档」入口（票 05）：唯一一行（无折叠、无尾部链接），Archive 图标 + 数量
 * （无归档显示 0）。点击右侧主内容区打开 /archived 归档页。
 * 移动端汉堡菜单由 MobileWorkspaceList 渲染同形一行（整页打开）。
 */
export function ArchivedGroupEntry() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { data: archived = [] } = useArchivedSessions()

    const active = location.pathname === '/archived'
    const open = useCallback(() => {
        void navigate({ to: '/archived' })
    }, [navigate])

    return (
        <EntryRow
            $token={token}
            $active={active}
            onClick={open}
            aria-label={t('nav.archived')}
        >
            <EntryIcon $token={token}><Archive size={14} /></EntryIcon>
            <EntryLabel>{t('nav.archived')}</EntryLabel>
            <EntryCount $token={token}>{archived.length}</EntryCount>
        </EntryRow>
    )
}
