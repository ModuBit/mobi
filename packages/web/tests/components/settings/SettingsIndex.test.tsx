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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/core/data/hooks/queries/useWebToolsStatus', () => ({
    useWebToolsStatus: vi.fn(),
}))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    // 入口列表仅在 mobile（<992px）形态渲染
    useMediaQuery: () => false,
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    // 浅 mock 下其他模块（i18n init）可能引用，补占位避免 mock 不完整报错
    initReactI18next: { type: '3rd-party', init: () => {} },
}))
vi.mock('@/components/settings/sections/NotificationsSection', () => ({
    NotificationsSection: () => <div data-testid="notifications-section" />,
}))
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => false }))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => () => {},
}))

import { SettingsIndex } from '@/components/settings/sections/SettingsIndex'
import { useWebToolsStatus } from '@/core/data/hooks/queries/useWebToolsStatus'

afterEach(() => cleanup())

describe('SettingsIndex（mobile 入口列表）', () => {
    it('渲染通知与 Web 工具入口，不含未解锁的调试入口', () => {
        vi.mocked(useWebToolsStatus).mockReturnValue('enabled')
        render(<SettingsIndex />)
        expect(screen.getByText('settings.sections.notifications.title')).toBeTruthy()
        expect(screen.getByText('settings.sections.webTools.title')).toBeTruthy()
        expect(screen.queryByText('settings.sections.debug.title')).toBeNull()
    })
    it('Web 工具入口显示已启用徽标', () => {
        vi.mocked(useWebToolsStatus).mockReturnValue('enabled')
        render(<SettingsIndex />)
        expect(screen.getByText('settings.sections.webTools.statusEnabled')).toBeTruthy()
    })
    it('offline 时显示机器离线徽标', () => {
        vi.mocked(useWebToolsStatus).mockReturnValue('offline')
        render(<SettingsIndex />)
        expect(screen.getByText('settings.sections.webTools.statusOffline')).toBeTruthy()
    })
})
