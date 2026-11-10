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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/** 媒体查询开关：mobile（入口列表形态）。PC 分流已由票02收口到 router 层 beforeLoad 重定向 */
const mediaMatches = { value: false }
vi.mock('@/core/data/hooks/queries/useWebToolsStatus', () => ({
    useWebToolsStatus: vi.fn(),
}))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useMediaQuery: () => mediaMatches.value,
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    // 浅 mock 下其他模块（i18n init）可能引用，补占位避免 mock 不完整报错
    initReactI18next: { type: '3rd-party', init: () => {} },
}))
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => false }))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => () => {},
}))

import { SettingsIndex } from '@/features/settings/sections/SettingsIndex'
import { useWebToolsStatus } from '@/core/data/hooks/queries/useWebToolsStatus'

afterEach(() => cleanup())

describe('SettingsIndex（mobile 入口列表）', () => {
    it('入口行渲染为可点按钮，含通知与 Web 工具，不含未解锁的调试入口', () => {
        mediaMatches.value = false
        vi.mocked(useWebToolsStatus).mockReturnValue('enabled')
        render(<SettingsIndex />)
        expect(screen.getByRole('button', { name: 'settings.sections.notifications.title' })).toBeTruthy()
        // web-tools 行可访问名含徽标文案（值 + chevron 并存），用前缀正则匹配
        expect(screen.getByRole('button', { name: /settings\.sections\.webTools\.title/ })).toBeTruthy()
        expect(screen.queryByRole('button', { name: /settings\.sections\.debug\.title/ })).toBeNull()
    })
    it('Web 工具入口行右侧显示已启用徽标（值 + chevron 并存）', () => {
        mediaMatches.value = false
        vi.mocked(useWebToolsStatus).mockReturnValue('enabled')
        render(<SettingsIndex />)
        expect(screen.getByText('settings.sections.webTools.statusEnabled')).toBeTruthy()
    })
    it('offline 时显示机器离线徽标', () => {
        mediaMatches.value = false
        vi.mocked(useWebToolsStatus).mockReturnValue('offline')
        render(<SettingsIndex />)
        expect(screen.getByText('settings.sections.webTools.statusOffline')).toBeTruthy()
    })
    it('loading 时行右侧无徽标（避免占位跳动）', () => {
        mediaMatches.value = false
        vi.mocked(useWebToolsStatus).mockReturnValue('loading')
        render(<SettingsIndex />)
        expect(screen.queryByText('settings.sections.webTools.statusEnabled')).toBeNull()
    })
    it('底部悬浮搜索：关键词过滤入口行，空态提示', () => {
        mediaMatches.value = false
        vi.mocked(useWebToolsStatus).mockReturnValue('enabled')
        render(<SettingsIndex />)
        const search = screen.getByRole('searchbox', { name: 'settings.search' })
        // i18n mock 下 titleKey 即文案：'memory' 命中记忆分区
        fireEvent.change(search, { target: { value: 'memory' } })
        expect(screen.getByRole('button', { name: 'settings.sections.memory.title' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'settings.sections.notifications.title' })).toBeNull()
        fireEvent.change(search, { target: { value: '不存在的关键词xyz' } })
        expect(screen.getByText('settings.searchEmpty')).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'settings.sections.memory.title' })).toBeNull()
    })
})
