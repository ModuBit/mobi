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
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { ConfigProvider, theme as antTheme, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { HelmetProvider } from 'react-helmet-async'
import { router } from './router'
import { useUiStore } from './stores/uiStore'
import i18n from './i18n'
import './index.css'

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 2,
        }
    }
})

// Shadcn 风格 Light 主题配置
const shadcnLightToken = {
    colorPrimary: '#18181b',
    colorSuccess: '#22c55e',
    colorWarning: '#f97316',
    colorError: '#ef4444',
    colorInfo: '#18181b',
    colorTextBase: '#18181b',
    colorBgBase: '#ffffff',
    colorPrimaryBg: '#f4f4f5',
    colorPrimaryBgHover: '#e4e4e7',
    colorPrimaryBorder: '#d4d4d8',
    colorPrimaryBorderHover: '#a1a1aa',
    colorPrimaryHover: '#27272a',
    colorPrimaryActive: '#09090b',
    colorPrimaryText: '#18181b',
    colorPrimaryTextHover: '#27272a',
    colorPrimaryTextActive: '#09090b',
    colorSuccessBg: '#f0fdf4',
    colorSuccessBgHover: '#dcfce7',
    colorSuccessBorder: '#bbf7d0',
    colorSuccessBorderHover: '#86efac',
    colorSuccessHover: '#16a34a',
    colorSuccessActive: '#15803d',
    colorSuccessText: '#16a34a',
    colorSuccessTextHover: '#16a34a',
    colorSuccessTextActive: '#15803d',
    colorWarningBg: '#fff7ed',
    colorWarningBgHover: '#fed7aa',
    colorWarningBorder: '#fdba74',
    colorWarningBorderHover: '#fb923c',
    colorWarningHover: '#ea580c',
    colorWarningActive: '#c2410c',
    colorWarningText: '#ea580c',
    colorWarningTextHover: '#ea580c',
    colorWarningTextActive: '#c2410c',
    colorErrorBg: '#fef2f2',
    colorErrorBgHover: '#fecaca',
    colorErrorBorder: '#fca5a5',
    colorErrorBorderHover: '#f87171',
    colorErrorHover: '#dc2626',
    colorErrorActive: '#b91c1c',
    colorErrorText: '#dc2626',
    colorErrorTextHover: '#dc2626',
    colorErrorTextActive: '#b91c1c',
    colorInfoBg: '#f4f4f5',
    colorInfoBgHover: '#e4e4e7',
    colorInfoBorder: '#d4d4d8',
    colorInfoBorderHover: '#a1a1aa',
    colorInfoHover: '#27272a',
    colorInfoActive: '#09090b',
    colorInfoText: '#18181b',
    colorInfoTextHover: '#27272a',
    colorInfoTextActive: '#09090b',
    colorText: '#18181b',
    colorTextSecondary: '#3f3f46',
    colorTextTertiary: '#71717a',
    colorTextQuaternary: '#a1a1aa',
    colorTextDisabled: '#a1a1aa',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#fafafa',
    colorBgSpotlight: '#18181b',
    colorBgMask: 'rgba(24, 24, 27, 0.45)',
    colorBorder: '#e4e4e7',
    colorBorderSecondary: '#f4f4f5',
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 14,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
}

// Shadcn 风格 Dark 主题配置
const shadcnDarkToken = {
    colorPrimary: '#fafafa',
    colorSuccess: '#22c55e',
    colorWarning: '#f97316',
    colorError: '#ef4444',
    colorInfo: '#fafafa',
    colorTextBase: '#fafafa',
    colorBgBase: '#09090b',
    colorPrimaryBg: '#27272a',
    colorPrimaryBgHover: '#3f3f46',
    colorPrimaryBorder: '#3f3f46',
    colorPrimaryBorderHover: '#52525b',
    colorPrimaryHover: '#e4e4e7',
    colorPrimaryActive: '#ffffff',
    // Primary 按钮背景是浅色，所以文字应该是深色
    colorPrimaryText: '#18181b',
    colorPrimaryTextHover: '#18181b',
    colorPrimaryTextActive: '#18181b',
    colorSuccessBg: '#052e16',
    colorSuccessBgHover: '#166534',
    colorSuccessBorder: '#166534',
    colorSuccessBorderHover: '#22c55e',
    colorSuccessHover: '#16a34a',
    colorSuccessActive: '#22c55e',
    colorSuccessText: '#22c55e',
    colorSuccessTextHover: '#22c55e',
    colorSuccessTextActive: '#4ade80',
    colorWarningBg: '#431407',
    colorWarningBgHover: '#7c2d12',
    colorWarningBorder: '#7c2d12',
    colorWarningBorderHover: '#f97316',
    colorWarningHover: '#ea580c',
    colorWarningActive: '#f97316',
    colorWarningText: '#f97316',
    colorWarningTextHover: '#f97316',
    colorWarningTextActive: '#fdba74',
    colorErrorBg: '#450a0a',
    colorErrorBgHover: '#7f1d1d',
    colorErrorBorder: '#7f1d1d',
    colorErrorBorderHover: '#ef4444',
    colorErrorHover: '#dc2626',
    colorErrorActive: '#ef4444',
    colorErrorText: '#ef4444',
    colorErrorTextHover: '#ef4444',
    colorErrorTextActive: '#fca5a5',
    colorInfoBg: '#27272a',
    colorInfoBgHover: '#3f3f46',
    colorInfoBorder: '#3f3f46',
    colorInfoBorderHover: '#52525b',
    colorInfoHover: '#e4e4e7',
    colorInfoActive: '#ffffff',
    colorInfoText: '#fafafa',
    colorInfoTextHover: '#e4e4e7',
    colorInfoTextActive: '#ffffff',
    colorText: '#fafafa',
    colorTextSecondary: '#d4d4d8',
    colorTextTertiary: '#a1a1aa',
    colorTextQuaternary: '#71717a',
    colorTextDisabled: '#52525b',
    colorBgContainer: '#18181b',
    colorBgElevated: '#27272a',
    colorBgLayout: '#09090b',
    colorBgSpotlight: '#fafafa',
    colorTextLightSolid: '#18181b',
    colorBgMask: 'rgba(0, 0, 0, 0.65)',
    colorBorder: '#27272a',
    colorBorderSecondary: '#18181b',
    borderRadius: 10,
    borderRadiusXS: 2,
    borderRadiusSM: 6,
    borderRadiusLG: 14,
    padding: 16,
    paddingSM: 12,
    paddingLG: 24,
    margin: 16,
    marginSM: 12,
    marginLG: 24,
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.3)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
}

// Shadcn 风格组件配置 - Light 模式
const shadcnLightComponents = {
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#e4e4e7',
        defaultColor: '#18181b',
        defaultBg: '#ffffff',
        defaultHoverBg: '#f4f4f5',
        defaultHoverBorderColor: '#d4d4d8',
        defaultHoverColor: '#18181b',
        defaultActiveBg: '#e4e4e7',
        defaultActiveBorderColor: '#d4d4d8',
        borderRadius: 6,
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#a1a1aa',
        activeBorderColor: '#18181b',
        borderRadius: 6,
    },
    Select: {
        optionSelectedBg: '#f4f4f5',
        optionActiveBg: '#fafafa',
        optionSelectedFontWeight: 500,
        borderRadius: 6,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 12,
    },
    Progress: {
        defaultColor: '#18181b',
        remainingColor: '#f4f4f5',
    },
    Steps: {
        iconSize: 32,
    },
    Switch: {
        trackHeight: 24,
        trackMinWidth: 44,
        innerMinMargin: 4,
        innerMaxMargin: 24,
    },
    Checkbox: {
        borderRadiusSM: 4,
    },
    Slider: {
        trackBg: '#f4f4f5',
        trackHoverBg: '#e4e4e7',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 6,
    },
    Card: {
        borderRadiusLG: 12,
    },
}

// Shadcn 风格组件配置 - Dark 模式
const shadcnDarkComponents = {
    Button: {
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: '#27272a',
        defaultColor: '#fafafa',
        defaultBg: '#18181b',
        defaultHoverBg: '#27272a',
        defaultHoverBorderColor: '#3f3f46',
        defaultHoverColor: '#fafafa',
        defaultActiveBg: '#3f3f46',
        defaultActiveBorderColor: '#52525b',
        borderRadius: 6,
        // Primary solid 按钮在 dark 模式下：背景浅色，文字深色
        primaryColor: '#18181b',
    },
    Input: {
        activeShadow: 'none',
        hoverBorderColor: '#52525b',
        activeBorderColor: '#fafafa',
        borderRadius: 6,
    },
    Select: {
        optionSelectedBg: '#27272a',
        optionActiveBg: '#18181b',
        optionSelectedFontWeight: 500,
        borderRadius: 6,
    },
    Alert: {
        borderRadiusLG: 8,
    },
    Modal: {
        borderRadiusLG: 12,
    },
    Progress: {
        defaultColor: '#fafafa',
        remainingColor: '#27272a',
    },
    Steps: {
        iconSize: 32,
    },
    Switch: {
        trackHeight: 24,
        trackMinWidth: 44,
        innerMinMargin: 4,
        innerMaxMargin: 24,
    },
    Checkbox: {
        borderRadiusSM: 4,
    },
    Slider: {
        trackBg: '#27272a',
        trackHoverBg: '#3f3f46',
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
    },
    ColorPicker: {
        borderRadius: 6,
    },
    Card: {
        borderRadiusLG: 12,
    },
}

// 动态主题提供者：订阅 uiStore.theme 和 locale，切换 Shadcn 风格主题
function ThemeProvider({ children }: { children: React.ReactNode }) {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <HelmetProvider>
            <ThemeProvider>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </ThemeProvider>
        </HelmetProvider>
    </React.StrictMode>
)
