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

import { Typography, Badge, Space, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SessionGroup } from '@/api/types'
import styled from '@emotion/styled'

const { Text } = Typography
const { useToken } = antTheme

const HeaderContainer = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding-right: 8px;
`

const GroupInfo = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
`

const GroupName = styled(Text)`
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

interface SessionGroupHeaderProps {
    group: SessionGroup
}

/**
 * 会话分组头部组件
 * 显示分组名称、活跃数量和总数
 */
export function SessionGroupHeader({ group }: SessionGroupHeaderProps) {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <HeaderContainer>
            <GroupInfo>
                <GroupName>{group.name}</GroupName>
                <Space size={4}>
                    {group.activeCount > 0 && (
                        <Badge
                            status="processing"
                            text={<Text type="secondary" style={{ fontSize: 12 }}>{group.activeCount} {t('sessionGroup.active')}</Text>}
                        />
                    )}
                    <Text type="secondary" style={{ fontSize: 12}}>
                        {t('sessionGroup.total', { count: group.totalCount })}
                    </Text>
                </Space>
            </GroupInfo>
        </HeaderContainer>
    )
}
