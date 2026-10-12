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

/**
 * 当前是否为暗色主题。
 *
 * 读 store 里解析后的档位：system 档所需的 OS 偏好由 store.systemIsDark 承载，
 * 写入方是 ThemeProvider 挂载的 subscribeSystemTheme。本 hook 只订阅不监听
 * matchMedia——与主界面主题（ThemeProvider 四通道）同源，OS 切档时一起翻档，
 * 不会出现「主界面还是亮色、终端已切暗色」的错位。
 */
export function useIsDark(): boolean {
    return useUiStore((s) => resolveTheme(s.theme, s.systemIsDark) === 'dark')
}
