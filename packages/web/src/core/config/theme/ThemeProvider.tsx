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
import { useUiStore } from '@/core/data/stores/uiStore'
import i18n from '@/core/config/i18n'
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
            // 两字按钮自动插空格（「连 接」）与三字以上按钮字距节奏不一致，全局关闭
            button={{ autoInsertSpace: false }}
            // 全站输入类默认 filled 形态：无边框、淡底填充（组件级 variant 显式传入时可覆盖）
            input={{ variant: 'filled' }}
            select={{ variant: 'filled' }}
            theme={{
                token: {
                    ...token,
                    // 输入类 focus halo 彻底关停：Select 直接用它画 box-shadow，Input 的
                    // activeShadow 默认派生也源于它——归零即全站输入框聚焦无环（无边框审美
                    // 的延续，filled 形态只靠淡底变化表达聚焦）
                    controlOutlineWidth: 0,
                },
                components,
                algorithm,
                // 显式开启 CSS 变量模式：把 token 注册为全局 --ant-* 自定义属性（v6 变量名为
                // kebab-case，如 --ant-color-warning）。组件层多处样式依赖这些变量（如
                // SubmitButton 光环的 color-mix、CommandProgressBubble 的 warning 色光标/
                // 进度条）——不开启时这些 var() 全部无效（光环透明不可见、颜色静默降级为继承色）。
                // v6 类型只接受 { prefix?, key? }，空对象 = 开启并走默认值
                cssVar: {},
            }}
        >
            <AntApp>
                {children}
            </AntApp>
        </ConfigProvider>
    )
}
