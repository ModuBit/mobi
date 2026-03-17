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
import type { SessionGroup } from '@/api/types'
import styled from '@emotion/styled'

const { Text } = Typography
const { useToken } = antTheme

const HeaderContainer = styled.div`
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
`

const GroupInfo = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
`

const GroupName = styled(Text)`
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 !important;
`

const CountText = styled(Text)`
    font-size: 12px;
    flex-shrink: 0;
    margin: 0 !important;
`

interface SessionGroupHeaderProps {
    group: SessionGroup
}

/**
 * 会话分组头部组件
 * 显示分组名称和会话数量
 */
export function SessionGroupHeader({ group }: SessionGroupHeaderProps) {
    const { token } = useToken()

    return (
        <HeaderContainer>
            <GroupInfo>
                <GroupName>{group.name}</GroupName>
                {group.activeCount > 0 && (
                    <Space size={4}>
                        <Badge status="processing" />
                        <CountText type="secondary">
                            ({group.activeCount})
                        </CountText>
                    </Space>
                )}
            </GroupInfo>
        </HeaderContainer>
    )
}
