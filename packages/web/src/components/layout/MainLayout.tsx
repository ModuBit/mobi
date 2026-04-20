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
import { RailNav } from './RailNav'
import { MobileMenuDrawer } from './MobileMenu'
import { SessionListDrawer } from './SessionListDrawer'
import { Outlet } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet-async'

/**
 * 主布局组件
 * 使用 antd Layout 组件组织 RailNav + Content
 */
export function MainLayout() {
    const { theme } = useUiStore()
    const { t } = useTranslation()

    // 缓存解析后的主题值
    const resolvedTheme = useMemo(() => resolveTheme(theme), [theme])

    // 应用主题
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
    }, [resolvedTheme])

    return (
        <ConfigProvider
            theme={{
                algorithm: resolvedTheme === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
            }}
        >
            <Helmet>
                <title>{t('siteTitle')}</title>
            </Helmet>
            <Layout style={{ height: '100vh', overflow: 'hidden', flexDirection: 'row' }}>
                <RailNav />
                <Layout.Content style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
                    <Outlet />
                </Layout.Content>
            </Layout>
            <SessionListDrawer />
            {/* 移动端底部弹出菜单 */}
            <MobileMenuDrawer />
        </ConfigProvider>
    )
}
