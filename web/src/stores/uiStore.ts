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
import i18n from '@/i18n'

// 会话视图模式
type SessionViewMode = 'chat' | 'files' | 'terminal'
// 文件视图 Tab
type FileViewTab = 'files' | 'git'
// 激活的模块
type ActiveModule = 'sessions' | 'skills' | 'mcp' | 'settings'
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

// 解析主题设置
export function resolveTheme(theme: Theme): 'light' | 'dark' {
    return theme === 'system' ? getSystemTheme() : theme
}

interface UiState {
    // 新状态
    sessionViewMode: SessionViewMode
    fileViewTab: FileViewTab
    activeModule: ActiveModule
    theme: Theme
    locale: Locale
    mobileMenuOpen: boolean
    // 保留兼容
    sidebarOpen: boolean
    // 操作方法
    setSessionViewMode: (mode: SessionViewMode) => void
    setFileViewTab: (tab: FileViewTab) => void
    setActiveModule: (module: ActiveModule) => void
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setTheme: (theme: Theme) => void
    setLocale: (locale: Locale) => void
    setMobileMenuOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            sessionViewMode: 'chat',
            fileViewTab: 'files',
            activeModule: 'sessions',
            sidebarOpen: true,
            theme: 'dark',
            locale: getSystemLocale(),
            mobileMenuOpen: false,
            setSessionViewMode: (mode) => set({ sessionViewMode: mode }),
            setFileViewTab: (tab) => set({ fileViewTab: tab }),
            setActiveModule: (module) => set({ activeModule: module }),
            setSidebarOpen: (open) => set({ sidebarOpen: open }),
            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
            setTheme: (theme) => set({ theme }),
            setLocale: (locale) => {
                i18n.changeLanguage(locale)
                return set({ locale })
            },
            setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
        }),
        {
            name: 'mobi-ui',
            // 持久化 theme 和 locale
            partialize: (state) => ({
                theme: state.theme,
                locale: state.locale,
            }),
            // 合并时保留 store 默认值，防止 localStorage 中无该字段时为 undefined
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...(persistedState as object),
            }),
        }
    )
)
