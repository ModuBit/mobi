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
import { WcoTitleBar } from './WcoTitleBar'
import { useWindowControlsOverlay } from './useWindowControlsOverlay'
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

    // WCO 标题栏：桌面 PWA 启用时替代系统标题栏；PC Web / 移动端 / standalone 返回 false 不受影响
    const isWco = useWindowControlsOverlay()

    // 应用主题：同步 data-theme + 浏览器 chrome（标签栏/地址栏）theme-color
    // 浅色用 colorBgContainer（纯白）、深色用 colorBgLayout —— 与 WcoTitleBar 同源，
    // 保证 chrome 标签栏与标题栏颜色完全一致
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
        const chromeColor = resolvedTheme === 'dark' ? token.colorBgLayout : token.colorBgContainer
        document.querySelectorAll('meta[name="theme-color"]')
            .forEach(m => m.setAttribute('content', chromeColor))
    }, [resolvedTheme, token.colorBgLayout, token.colorBgContainer])

    // 注册 Service Worker（DEV 也注册 dev-sw type:module，含 push handler；不再跳过）
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
            {/* 外层 column 容器：WCO 标题栏在上（独立于下方 row Layout 的横向流），不受 AppSidebar overflow 裁剪 */}
            <div style={{
                height: '100dvh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}>
                {isWco && <WcoTitleBar />}
                <Layout style={{
                    flex: 1,
                    minHeight: 0,
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
            </div>
            <SessionListDrawer />
            {/* 移动端底部弹出菜单 */}
            <MobileMenuDrawer />
        </ConfigProvider>
    )
}
