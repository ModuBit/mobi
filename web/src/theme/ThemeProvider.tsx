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

import React, { useEffect } from 'react'
import { ConfigProvider, theme as antTheme, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { useUiStore } from '@/stores/uiStore'
import i18n from '@/i18n'
import { shadcnLightToken, shadcnDarkToken } from './tokens'
import { shadcnLightComponents, shadcnDarkComponents } from './components'

// 动态主题提供者：订阅 uiStore.theme 和 locale，切换 Shadcn 风格主题
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const theme = useUiStore((state) => state.theme)
    const locale = useUiStore((state) => state.locale)
    const isDark = theme === 'dark'
    const token = isDark ? shadcnDarkToken : shadcnLightToken
    const components = isDark ? shadcnDarkComponents : shadcnLightComponents
    const algorithm = isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm
    const antdLocale = locale === 'zh' ? zhCN : enUS

    // 同步 data-theme 属性到 html 元素，用于 CSS 选择器
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
    }, [theme])

    // 同步 i18n 语言
    useEffect(() => {
        i18n.changeLanguage(locale)
    }, [locale])

    return (
        <ConfigProvider
            locale={antdLocale}
            theme={{
                token,
                components,
                algorithm,
            }}
        >
            <AntApp>
                {children}
            </AntApp>
        </ConfigProvider>
    )
}
