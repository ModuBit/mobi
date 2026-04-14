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

import { Empty, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useSessionGroups } from '@/hooks/queries/useSessionGroups'
import { NewSession } from '@/components/NewSession'
import styled from '@emotion/styled'

const Container = styled.div`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    flex: 1;
`

const NewSessionWrapper = styled.div`
    width: 100%;
    max-width: 480px;
    height: 100%;
    overflow: auto;
`

/**
 * 会话列表页（索引）
 * - 空列表时显示新建会话表单
 * - 有会话时提示选择
 */
export function SessionsPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: groups = [], isLoading } = useSessionGroups()
    const hasSessions = groups.some(g => g.totalCount > 0)

    if (isLoading) {
        return (
            <Container>
                <Spin size="large" />
            </Container>
        )
    }

    // 空列表：显示新建会话表单
    if (!hasSessions) {
        return (
            <Container>
                <NewSessionWrapper>
                    <NewSession
                        onSuccess={(sessionId) => {
                            navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                        }}
                        onCancel={() => {}}
                    />
                </NewSessionWrapper>
            </Container>
        )
    }

    // 有会话：提示选择
    return (
        <Container>
            <Empty description={t('session.selectToView')} />
        </Container>
    )
}
