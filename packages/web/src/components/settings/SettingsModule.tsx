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
import { SidebarToggle } from '@/components/layout/SidebarToggle'
import { PageHeader } from '@/components/layout/PageHeader'
import { NotificationSettings } from './NotificationSettings'
import { DebugSection } from './blocks/DebugSection'
import styled from '@emotion/styled'

const { Title } = Typography
const { useToken } = antTheme

const SettingsContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
`

const SettingsContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    min-height: 0; /* flex 子项可缩小，overflow 才生效（父 Content overflow:hidden） */
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    /* 底部避让 home 指示条；桌面 env=0 保持 24px */
    padding: 24px 24px max(24px, env(safe-area-inset-bottom));
`

export function SettingsModule() {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <SettingsContainer $token={token}>
            <PageHeader
                left={<>
                    <SidebarToggle />
                    <MobileMenuButton />
                    <Title level={5} style={{ margin: 0 }}>{t('settings.title')}</Title>
                </>}
            />
            <SettingsContent $token={token}>
                {/*
                    namespace：hub 端从 token 自动解析，client 无需传值，
                    传空串作为语义占位（useNotificationSetup 内部 void 标注）。
                */}
                <NotificationSettings namespace="" />
                {/* 调试区块：未解锁时不渲染（见 blocks/DebugSection） */}
                <DebugSection />
            </SettingsContent>
        </SettingsContainer>
    )
}
