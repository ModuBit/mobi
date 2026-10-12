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

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n from '@/core/config/i18n'

// 主题（支持 system）
type Theme = 'light' | 'dark' | 'system'
// 语言
type Locale = 'zh' | 'en'

// 获取系统主题
function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 获取系统语言
function getSystemLocale(): Locale {
    if (typeof navigator === 'undefined') return 'zh'
    const lang = navigator.language.toLowerCase()
    return lang.startsWith('zh') ? 'zh' : 'en'
}

// 解析主题设置：system 档落 OS 偏好。OS 偏好的实时值由调用方注入（store.systemIsDark）
// 而非此处现读 matchMedia——现读的值不参与选择器入参比较，OS 切档时 store 无变更，
// 消费点便留着旧档（订阅与通知的完整机制见 subscribeSystemTheme）
export function resolveTheme(theme: Theme, systemIsDark: boolean): 'light' | 'dark' {
    return theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme
}

// OS 偏好订阅的引用计数与摘钩子：ThemeProvider 是唯一订阅方，此处只保证
// 重复挂载（StrictMode 双跑）不叠加监听、卸载到 0 才真正摘除
let systemThemeSubscribers = 0
let stopSystemThemeListen: (() => void) | null = null

/**
 * 订阅 OS 暗色偏好并同步进 store.systemIsDark；返回取消订阅函数。
 *
 * system 档的解析结果是一个「派生自 store 之外」的值，调用方统一写成
 * `useUiStore((s) => resolveTheme(s.theme, s.systemIsDark))`——它只在 store 变更时重算。
 * OS 切档本身不动 store，所以必须有人把 matchMedia 的变化写进 store 触发这次重算；
 * 这个职责归 ThemeProvider（全站主题单源）独占，其余消费点只读不监听，
 * 避免此前 ThemeProvider 不跟 OS、terminal/sketchpad 各自跟 OS 的两套行为。
 */
export function subscribeSystemTheme(): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => useUiStore.setState({ systemIsDark: mql.matches })

    systemThemeSubscribers += 1
    if (!stopSystemThemeListen) {
        // 立即对齐一次：store 创建时读到的值与本组件挂载时的 OS 偏好可能已经不同
        sync()
        mql.addEventListener('change', sync)
        stopSystemThemeListen = () => mql.removeEventListener('change', sync)
    }
    return () => {
        systemThemeSubscribers -= 1
        if (systemThemeSubscribers === 0 && stopSystemThemeListen) {
            stopSystemThemeListen()
            stopSystemThemeListen = null
        }
    }
}

interface UiState {
    theme: Theme
    /** OS 暗色偏好——system 档的解析输入，由 subscribeSystemTheme 同步；不持久化 */
    systemIsDark: boolean
    locale: Locale
    mobileMenuOpen: boolean
    // 侧边栏展开/收起（桌面端）
    sidebarExpanded: boolean
    // 重命名
    renamingSessionId: string | null
    renameValue: string
    // 操作方法
    setTheme: (theme: Theme) => void
    setLocale: (locale: Locale) => void
    setMobileMenuOpen: (open: boolean) => void
    toggleSidebar: () => void
    startRename: (sessionId: string, currentValue: string) => void
    setRenameValue: (value: string) => void
    cancelRename: () => void
}

export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            theme: 'dark',
            systemIsDark: getSystemTheme() === 'dark',
            locale: getSystemLocale(),
            mobileMenuOpen: false,
            sidebarExpanded: true,
            renamingSessionId: null,
            renameValue: '',
            setTheme: (theme) => set({ theme }),
            setLocale: (locale) => {
                i18n.changeLanguage(locale)
                return set({ locale })
            },
            setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
            toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
            startRename: (sessionId, currentValue) => set({ renamingSessionId: sessionId, renameValue: currentValue }),
            setRenameValue: (value) => set({ renameValue: value }),
            cancelRename: () => set({ renamingSessionId: null, renameValue: '' }),
        }),
        {
            name: 'mobi-ui',
            // 持久化 theme、locale 和 sidebarExpanded
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
                sidebarExpanded: state.sidebarExpanded,
            }),
            // 合并时保留 store 默认值，防止 localStorage 中无该字段时为 undefined
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...(persistedState as object),
            }),
        }
    )
)
