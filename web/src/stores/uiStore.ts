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

type ActiveTab = 'chat' | 'files' | 'git' | 'terminal'
type Theme = 'light' | 'dark'
type Locale = 'zh' | 'en'

// 获取系统语言
function getSystemLocale(): Locale {
    if (typeof navigator === 'undefined') return 'zh'
    const lang = navigator.language.toLowerCase()
    return lang.startsWith('zh') ? 'zh' : 'en'
}

interface UiState {
    activeTab: ActiveTab
    sidebarOpen: boolean
    theme: Theme
    locale: Locale
    setActiveTab: (tab: ActiveTab) => void
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    toggleTheme: () => void
    toggleLocale: () => void
}

export const useUiStore = create<UiState>()(
    persist(
        (set) => ({
            activeTab: 'chat',
            sidebarOpen: false,
            // 默认 dark 主题
            theme: 'dark',
            // 默认系统语言
            locale: getSystemLocale(),
            setActiveTab: (tab) => set({ activeTab: tab }),
            setSidebarOpen: (open) => set({ sidebarOpen: open }),
            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
            toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
            toggleLocale: () => set((state) => {
                const newLocale = state.locale === 'zh' ? 'en' : 'zh'
                i18n.changeLanguage(newLocale)
                return { locale: newLocale }
            }),
        }),
        {
            name: 'mobi-ui',
            // 持久化 theme 和 locale
            partialize: (state) => ({ theme: state.theme, locale: state.locale }),
            // 合并时保留 store 默认值，防止 localStorage 中无该字段时为 undefined
            merge: (persistedState, currentState) => ({
                ...currentState,
                ...(persistedState as object),
            }),
        }
    )
)
