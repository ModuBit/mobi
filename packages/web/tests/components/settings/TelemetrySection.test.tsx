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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider, App as AntdApp } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// 稳定引用（模块级单例）：useMobiApi 每次渲染返回同一对象，避免 effect 无限循环（worker OOM 前车之鉴）
const stableApi = {
    telemetry: { get: vi.fn(), set: vi.fn() },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))

// i18n：key → 断言用中文文案（与 locales zh.json 对齐的最小子集）
const i18nMap = vi.hoisted(() => ({
    'settings.telemetry.cardTitle': '会话遥测（OpenTelemetry）',
    'settings.telemetry.enabledLabel': '启用 trace 导出',
    'settings.telemetry.privacyHint': '仅导出 trace span，不含对话内容',
    'settings.telemetry.endpointLabel': 'OTLP Endpoint',
    'settings.telemetry.endpointRequired': '启用时必须填写 OTLP Endpoint',
    'settings.telemetry.headersLabel': '认证头',
    'settings.telemetry.headersPlaceholder': 'K=V,K2=V2（如 DD-API-KEY=xxx）',
    'settings.telemetry.headersSetPlaceholder': '已设置——输入新值覆盖',
    'settings.telemetry.headersHint': '云产品接入的认证 header，随导出请求一并发送',
    'settings.telemetry.headersInvalid': '认证头格式应为 K=V,K2=V2',
    'settings.telemetry.headersClear': '清除已存认证头',
    'settings.telemetry.headersCleared': '认证头已清除',
    'settings.telemetry.saveButton': '保存',
    'settings.telemetry.savedHint': '已保存，下个新会话生效',
    'settings.telemetry.saveFailed': '保存失败',
    'settings.telemetry.loadFailed': '遥测设置加载失败（daemon 不可达）',
    'settings.telemetry.effectiveNextSession': '下个新会话生效',
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, string | number>) => {
            let text = i18nMap[key] ?? key
            if (opts) {
                for (const [name, value] of Object.entries(opts)) {
                    text = text.replaceAll(`{{${name}}}`, String(value))
                }
            }
            return text
        },
    }),
}))

import { TelemetrySection } from '@/features/settings/sections/TelemetrySection'

function renderSection() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <ConfigProvider>
                <AntdApp>
                    <TelemetrySection />
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})
afterEach(cleanup)

describe('TelemetrySection 关闭态', () => {
    it('enabled=false 只渲染隐私说明，不渲染 endpoint/认证头输入', async () => {
        stableApi.telemetry.get.mockResolvedValue({ data: { settings: { headersSet: false } } })
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.telemetry.privacyHint'])).toBeInTheDocument())
        expect(screen.queryByLabelText('OTLP Endpoint')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('认证头')).not.toBeInTheDocument()
    })

    it('加载失败（daemon 不可达）：不渲染表单，显示加载失败提示', async () => {
        stableApi.telemetry.get.mockRejectedValue(new Error('network down'))
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.telemetry.loadFailed'])).toBeInTheDocument())
        expect(screen.queryByLabelText('OTLP Endpoint')).not.toBeInTheDocument()
    })
})

describe('TelemetrySection 开启态与保存', () => {
    beforeEach(() => {
        stableApi.telemetry.get.mockResolvedValue({
            data: { settings: { enabled: true, endpoint: 'http://localhost:4318', headersSet: true } },
        })
        stableApi.telemetry.set.mockResolvedValue({ data: { settings: { enabled: true, headersSet: true } } })
    })

    it('已存配置回显：endpoint 回填、认证头已存占位与清除按钮', async () => {
        renderSection()
        await waitFor(() => expect((screen.getByLabelText('OTLP Endpoint') as HTMLInputElement).value)
            .toBe('http://localhost:4318'))
        expect(screen.getByText(i18nMap['settings.telemetry.headersClear'])).toBeInTheDocument()
    })

    it('保存：合法认证头解析成 record 提交；草稿清空', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('认证头')).toBeInTheDocument())
        fireEvent.change(screen.getByLabelText('认证头'), { target: { value: 'DD-API-KEY= secret , k2=v2' } })
        fireEvent.click(screen.getByText(i18nMap['settings.telemetry.saveButton']))

        await waitFor(() => expect(stableApi.telemetry.set).toHaveBeenCalledWith({
            enabled: true,
            endpoint: 'http://localhost:4318',
            headers: { 'DD-API-KEY': 'secret', k2: 'v2' },
        }))
    })

    it('非法认证头（缺 =）→ 拦截提交', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('认证头')).toBeInTheDocument())
        fireEvent.change(screen.getByLabelText('认证头'), { target: { value: 'not-a-pair' } })
        fireEvent.click(screen.getByText(i18nMap['settings.telemetry.saveButton']))

        await waitFor(() => expect(screen.getByText(i18nMap['settings.telemetry.headersInvalid'])).toBeInTheDocument())
        expect(stableApi.telemetry.set).not.toHaveBeenCalled()
    })

    it('启用但未填 endpoint → 拦截提交', async () => {
        stableApi.telemetry.get.mockResolvedValue({ data: { settings: { enabled: false, headersSet: false } } })
        renderSection()
        await waitFor(() => expect(screen.getByRole('switch')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('switch')) // 开启 → endpoint 输入出现（空）
        fireEvent.click(screen.getByText(i18nMap['settings.telemetry.saveButton']))

        await waitFor(() => expect(screen.getByText(i18nMap['settings.telemetry.endpointRequired'])).toBeInTheDocument())
        expect(stableApi.telemetry.set).not.toHaveBeenCalled()
    })

    it('清除已存认证头：显式提交空对象', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByText(i18nMap['settings.telemetry.headersClear'])).toBeInTheDocument())
        fireEvent.click(screen.getByText(i18nMap['settings.telemetry.headersClear']))

        await waitFor(() => expect(stableApi.telemetry.set).toHaveBeenCalledWith({ headers: {} }))
    })
})
