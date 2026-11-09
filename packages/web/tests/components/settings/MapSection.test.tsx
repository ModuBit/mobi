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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const stableApi = {
    map: { get: vi.fn(), set: vi.fn() },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))

// i18n：key → 断言用中文文案（与 locales zh.json 对齐的最小子集）
const i18nMap = vi.hoisted(() => ({
    'settings.map.title': '地图配置',
    'settings.map.modeLabel': '渲染档位',
    'settings.map.modeInteractive': '交互地图',
    'settings.map.modeStatic': '静态地图',
    'settings.map.modeNone': '未配置',
    'settings.map.modeHint': 'JS API key + 安全密钥齐备时用交互地图',
    'settings.map.jsApiKeyLabel': 'JS API key（Web 端）',
    'settings.map.jsApiKeyHint': '高德控制台创建的「Web 端（JS API）」key',
    'settings.map.securityJsCodeLabel': '安全密钥 securityJsCode',
    'settings.map.securityJsCodeHint': '与 JS API key 配套',
    'settings.map.webServiceKeyLabel': 'Web 服务 key',
    'settings.map.webServiceKeyHint': '静态地图使用',
    'settings.map.setPlaceholder': '已设置（留空保持不变）',
    'settings.map.emptyPlaceholder': '未设置',
    'settings.map.save': '保存',
    'settings.map.saved': '已保存',
    'settings.map.saveFailed': '保存失败',
    'settings.map.clear': '清除全部',
    'settings.map.offline': 'daemon 不可达，无法读取设置',
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => i18nMap[key] ?? key }),
}))

import { MapSection } from '@/features/settings/sections/MapSection'

function renderSection() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <ConfigProvider>
                <MapSection />
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})
afterEach(cleanup)

describe('MapSection 行式形态（局部保存，票06）', () => {
    it('加载失败（daemon 不可达）：显示离线提示，保存/清除不可用（hook 层双保险拒写）', async () => {
        stableApi.map.get.mockResolvedValue({ data: { status: 'offline' } })
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.map.offline'])).toBeInTheDocument())
        expect(screen.getByRole('button', { name: i18nMap['settings.map.save'] })).toBeDisabled()
        expect(screen.getByRole('button', { name: i18nMap['settings.map.clear'] })).toBeDisabled()
    })

    it('渲染档位由 daemon 推导回显（前端不重复判定）', async () => {
        stableApi.map.get.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'interactive' } },
        })
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.map.modeInteractive'])).toBeInTheDocument())
    })

    it('已设置 key 回显占位；留空保存不携带该字段（在场性=保持）', async () => {
        stableApi.map.get.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'static', jsApiKey: 'js-set', webServiceKeySet: true } },
        })
        stableApi.map.set.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'static' } },
        })
        renderSection()
        const jsInput = screen.getByLabelText(i18nMap['settings.map.jsApiKeyLabel']) as HTMLInputElement
        // 输入恒渲染（离线也可见）；等 settings 到位后占位才切「已设置」
        await waitFor(() => expect(jsInput.getAttribute('placeholder')).toBe(i18nMap['settings.map.setPlaceholder']))

        // 只填 webServiceKey，其余留空：提交只携带填写字段
        fireEvent.change(screen.getByLabelText(i18nMap['settings.map.webServiceKeyLabel']), {
            target: { value: 'ws-new' },
        })
        fireEvent.click(screen.getByRole('button', { name: i18nMap['settings.map.save'] }))
        await waitFor(() => expect(stableApi.map.set).toHaveBeenCalledWith({ webServiceKey: 'ws-new' }))
        // 保存成功回执 + 草稿清空
        expect(screen.getByText(i18nMap['settings.map.saved'])).toBeInTheDocument()
        expect((screen.getByLabelText(i18nMap['settings.map.webServiceKeyLabel']) as HTMLInputElement).value).toBe('')
    })

    it('清除全部：显式提交三空串（在场性=清除）', async () => {
        stableApi.map.get.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'none', webServiceKeySet: true } },
        })
        stableApi.map.set.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'none' } },
        })
        renderSection()
        // 等 settings 到位（档位 Tag 由 settings 派生；未加载时清除按钮 disabled、click 无效）
        await waitFor(() => expect(screen.getByText(i18nMap['settings.map.modeNone'])).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: i18nMap['settings.map.clear'] }))
        await waitFor(() => expect(stableApi.map.set).toHaveBeenCalledWith({
            jsApiKey: '',
            securityJsCode: '',
            webServiceKey: '',
        }))
    })

    it('保存失败：展示失败提示（不假显已保存）', async () => {
        stableApi.map.get.mockResolvedValue({
            data: { status: 'ok', settings: { mode: 'none' } },
        })
        stableApi.map.set.mockResolvedValue({ data: { error: 'bad request' } })
        renderSection()
        await waitFor(() => expect(screen.getByLabelText(i18nMap['settings.map.jsApiKeyLabel'])).toBeInTheDocument())

        fireEvent.change(screen.getByLabelText(i18nMap['settings.map.jsApiKeyLabel']), { target: { value: 'k' } })
        fireEvent.click(screen.getByRole('button', { name: i18nMap['settings.map.save'] }))
        await waitFor(() => expect(screen.getByText(i18nMap['settings.map.saveFailed'])).toBeInTheDocument())
    })
})
