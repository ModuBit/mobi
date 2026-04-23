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

import { theme as antTheme, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { PageHeader } from '@/components/layout/PageHeader'
import styled from '@emotion/styled'

const { Title, Text } = Typography
const { useToken } = antTheme

const SettingsContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
`

const SettingsContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
`

export function SettingsModule() {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <SettingsContainer $token={token}>
            <PageHeader
                left={<>
                    <MobileMenuButton />
                    <Title level={5} style={{ margin: 0 }}>{t('settings.title')}</Title>
                </>}
            />
            <SettingsContent $token={token}>
                <Text type="secondary">{t('settings.comingSoon')}</Text>
            </SettingsContent>
        </SettingsContainer>
    )
}
