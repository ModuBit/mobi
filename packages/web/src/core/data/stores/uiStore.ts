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

// 解析主题设置
export function resolveTheme(theme: Theme): 'light' | 'dark' {
    return theme === 'system' ? getSystemTheme() : theme
}

interface UiState {
    theme: Theme
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
