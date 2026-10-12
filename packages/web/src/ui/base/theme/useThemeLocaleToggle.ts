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

import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { switchTheme } from '@/core/lib/themeTransition'

export function useThemeLocaleToggle() {
    const { theme, systemIsDark, locale, setLocale } = useUiStore()
    const resolvedTheme = resolveTheme(theme, systemIsDark)

    // 换档走 switchTheme（View Transition 编排 + 主题写入口），不直接调 store.setTheme
    const toggleTheme = () => switchTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    const toggleLocale = () => setLocale(locale === 'zh' ? 'en' : 'zh')

    return { resolvedTheme, locale, toggleTheme, toggleLocale }
}
