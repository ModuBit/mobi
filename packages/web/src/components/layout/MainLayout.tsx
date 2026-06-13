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

import { theme as antTheme, ConfigProvider, Layout } from 'antd'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { AppSidebar } from './AppSidebar'
import { MobileMenuDrawer } from './MobileMenu'
import { SessionListDrawer } from './SessionListDrawer'
import { Outlet } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet-async'
import { UpdatePrompt } from './UpdatePrompt'
import { registerServiceWorker } from '@/core/pwa/registerSW'

const { useToken } = antTheme

/**
 * 主布局组件
 * 使用 antd Layout 组件组织 AppSidebar + Content
 */
export function MainLayout() {
    const { theme } = useUiStore()
    const { t } = useTranslation()
    const { token } = useToken()
    const isMobile = useIsMobile()
    const sidebarExpanded = useUiStore((s) => s.sidebarExpanded)
    const resolvedTheme = useMemo(() => resolveTheme(theme), [theme])

    // PWA 更新回调
    const [updateReload, setUpdateReload] = useState<(() => void) | null>(null)

    // 应用主题
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
    }, [resolvedTheme])

    // 注册 Service Worker
    useEffect(() => {
        const unregister = registerServiceWorker((reload) => {
            setUpdateReload(() => reload)
        })
        return unregister
    }, [])

    return (
        <ConfigProvider
            theme={{
                algorithm: resolvedTheme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
            }}
        >
            <Helmet>
                <title>{t('siteTitle')}</title>
            </Helmet>
            <UpdatePrompt onUpdate={updateReload} />
            <Layout style={{
                height: '100dvh',
                overflow: 'hidden',
                flexDirection: 'row',
                background: token.colorBgContainer,
            }}>
                <AppSidebar />
                <Layout.Content style={{
                    flex: 1,
                    display: 'flex',
                    overflow: 'hidden',
                    minWidth: 0,
                    borderRadius: !isMobile && sidebarExpanded ? '12px 0 0 12px' : undefined,
                    borderLeft: !isMobile && sidebarExpanded ? `1px solid ${token.colorBorder}` : undefined,
                    background: token.colorBgLayout,
                }}>
                    <Outlet />
                </Layout.Content>
            </Layout>
            <SessionListDrawer />
            {/* 移动端底部弹出菜单 */}
            <MobileMenuDrawer />
        </ConfigProvider>
    )
}
