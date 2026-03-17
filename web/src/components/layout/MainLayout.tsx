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

import { theme as antTheme, ConfigProvider } from 'antd'
import { useUiStore, resolveTheme } from '@/stores/uiStore'
import { RailNav } from './RailNav'
import { SessionModule } from '@/components/session/SessionModule'
import { SettingsModule } from '@/components/settings/SettingsModule'
import { useEffect, useMemo } from 'react'
import styled from '@emotion/styled'

const { useToken } = antTheme

const LayoutContainer = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: ${props => props.$token.colorBgLayout};
`

const MainContent = styled.main`
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
`

// 占位模块组件
function PlaceholderModule({ name }: { name: string }) {
    const { token } = useToken()
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: token.colorTextSecondary
        }}>
            {name} 模块开发中...
        </div>
    )
}

export function MainLayout() {
    const { token } = useToken()
    const { activeModule, theme } = useUiStore()

    // 缓存解析后的主题值
    const resolvedTheme = useMemo(() => resolveTheme(theme), [theme])

    // 应用主题
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
    }, [resolvedTheme])

    // 渲染内容区
    const renderContent = () => {
        switch (activeModule) {
            case 'sessions':
                return <SessionModule />
            case 'settings':
                return <SettingsModule />
            case 'skills':
            case 'mcp':
                return <PlaceholderModule name={activeModule.toUpperCase()} />
            default:
                return <SessionModule />
        }
    }

    return (
        <ConfigProvider
            theme={{
                algorithm: resolvedTheme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
            }}
        >
            <LayoutContainer $token={token}>
                <RailNav />
                <MainContent>
                    {renderContent()}
                </MainContent>
            </LayoutContainer>
        </ConfigProvider>
    )
}
