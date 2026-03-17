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

import { Collapse, Empty, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { SessionGroupHeader } from './SessionGroupHeader'
import { SessionGroupContent } from './SessionGroupContent'
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'

const { useToken } = antTheme

const GroupListContainer = styled.div`
    padding: 8px 4px;
`

const EmptyContainer = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
`

/**
 * 会话分组列表组件
 * 使用 Ant Design Collapse 展示分组会话
 */
export function SessionGroupList() {
    const { token } = useToken()
    const { data: groups = [], isLoading } = useSessionGroups()
    const { t } = useTranslation()

    if (isLoading) {
        return <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 16 }} />
    }

    if (groups.length === 0) {
        return (
            <EmptyContainer>
                <Empty description={t('session.empty')} />
            </EmptyContainer>
        )
    }

    const collapseItems = groups.map((group) => ({
        key: group.key,
        label: <SessionGroupHeader group={group} />,
        children: <SessionGroupContent groupKey={group.key} />,
        style: {
            marginBottom: 8,
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorBorder}`,
        }
    }))

    return (
        <GroupListContainer>
            <Collapse
                accordion={false}
                defaultActiveKey={groups.filter(g => g.activeCount > 0).map(g => g.key)}
                items={collapseItems}
                bordered={false}
                expandIconPosition="end"
                style={{ background: 'transparent' }}
            />
        </GroupListContainer>
    )
}
