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

import { describe, expect, it } from 'vitest'
import { isSettingsPath } from '@/domain/navigation/settingsPath'

describe('设置路由族判断', () => {
    it('命中 /settings 与子路径', () => {
        expect(isSettingsPath('/settings')).toBe(true)
        expect(isSettingsPath('/settings/notifications')).toBe(true)
        expect(isSettingsPath('/settings/')).toBe(true)
    })

    it('不命中前缀相似的其他路由', () => {
        expect(isSettingsPath('/settingsfoo')).toBe(false)
        expect(isSettingsPath('/sessions/new')).toBe(false)
        expect(isSettingsPath('/')).toBe(false)
    })
})
