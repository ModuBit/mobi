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

import { theme as antTheme, Layout, Typography, Divider, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/uiStore'
import { MobileMenuButton } from '@/components/layout/MobileMenu'
import { PageHeader } from '@/components/layout/PageHeader'
import { Globe, Palette } from 'lucide-react'
import styled from '@emotion/styled'

const { Title, Text } = Typography
const { useToken } = antTheme

const SettingsContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    height: 100%;
`

const SettingsSidebar = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 200px;
    height: 100%;
    border-right: 1px solid ${props => props.$token.colorBorder};
    background: ${props => props.$token.colorBgContainer};
    padding: 16px;

    @media (max-width: 767px) {
        display: none;
    }
`

const SettingsContent = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    flex: 1;
    overflow: auto;
    padding: 24px;
    max-width: 600px;
`

const SettingItem = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
`

const SettingLabel = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
`

// 设置菜单项
const menuItems = [
    { key: 'general', label: 'settings.general' },
    { key: 'account', label: 'settings.account', disabled: true },
    { key: 'notifications', label: 'settings.notifications', disabled: true },
    { key: 'about', label: 'settings.about', disabled: true },
]

export function SettingsModule() {
    const { token } = useToken()
    const { t } = useTranslation()
    const { locale, setLocale, theme, setTheme } = useUiStore()

    return (
        <SettingsContainer $token={token}>
            <SettingsSidebar $token={token}>
                <Title level={5} style={{ marginBottom: 16 }}>{t('settings.title')}</Title>
                {menuItems.map((item) => (
                    <div
                        key={item.key}
                        style={{
                            padding: '8px 12px',
                            borderRadius: 6,
                            cursor: item.disabled ? 'not-allowed' : 'pointer',
                            opacity: item.disabled ? 0.4 : 1,
                            background: item.key === 'general' ? token.colorPrimaryBg : 'transparent',
                            color: item.key === 'general' ? token.colorPrimary : token.colorText,
                            marginBottom: 4,
                        }}
                    >
                        {t(item.label)}
                    </div>
                ))}
            </SettingsSidebar>
            <Layout style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* 移动端 Header */}
                <PageHeader
                    left={<MobileMenuButton />}
                    right={<Title level={5} style={{ margin: 0 }}>{t('settings.title')}</Title>}
                />

                <Layout.Content>
                    <SettingsContent $token={token}>
                    <Title level={4}>{t('settings.general')}</Title>
                    <Divider />

                    {/* 语言设置 */}
                    <SettingItem>
                        <SettingLabel>
                            <Globe size={18} color={token.colorTextSecondary} />
                            <div>
                                <Text strong>{t('settings.language')}</Text>
                            </div>
                        </SettingLabel>
                        <Select
                            value={locale}
                            onChange={setLocale}
                            style={{ width: 150 }}
                            options={[
                                { value: 'zh', label: '简体中文' },
                                { value: 'en', label: 'English' },
                            ]}
                        />
                    </SettingItem>

                    <Divider />

                    {/* 主题设置 */}
                    <SettingItem>
                        <SettingLabel>
                            <Palette size={18} color={token.colorTextSecondary} />
                            <div>
                                <Text strong>{t('settings.theme')}</Text>
                            </div>
                        </SettingLabel>
                        <Select
                            value={theme}
                            onChange={setTheme}
                            style={{ width: 150 }}
                            options={[
                                { value: 'light', label: t('settings.themeLight') },
                                { value: 'dark', label: t('settings.themeDark') },
                                { value: 'system', label: t('settings.themeSystem') },
                            ]}
                        />
                    </SettingItem>
                </SettingsContent>
                </Layout.Content>
            </Layout>
        </SettingsContainer>
    )
}
