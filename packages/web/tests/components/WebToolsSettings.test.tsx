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
import { ConfigProvider, App as AntdApp } from 'antd'

// 稳定引用（模块级单例）：useMobiApi 每次渲染返回同一对象，避免 effect 无限循环（worker OOM 前车之鉴）
const stableApi = {
    machines: {
        list: vi.fn(),
        webTools: { get: vi.fn(), set: vi.fn() },
    },
}

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))

// i18n：key → 断言用中文文案（与 locales zh.json 对齐的最小子集），vi.hoisted 解决 mock 工厂提升
const i18nMap = vi.hoisted(() => ({
    'settings.webTools.title': 'Web 工具',
    'settings.webTools.providers.tavily': 'Tavily',
    'settings.webTools.providers.bocha': '博查',
    'settings.webTools.apiKey': 'API Key',
    'settings.webTools.credentialSet': '已设置（留空保持不变）',
    'settings.webTools.credentialUnset': '未设置',
    'settings.webTools.saved': '已保存',
    'settings.webTools.saveFailed': '保存失败',
    'settings.webTools.save': '保存',
    'settings.webTools.offline': '机器离线，无法读取配置',
    'settings.webTools.notConfigured': '未配置——模型调用 web 工具将返回未配置提示',
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => i18nMap[key] ?? key,
    }),
}))

import { WebToolsSettings } from '@/components/settings/WebToolsSettings'

/** 渲染：ConfigProvider + AntdApp 让 App.useApp().message 可用（toast 渲染进 DOM 可断言） */
function renderCard() {
    return render(
        <ConfigProvider>
            <AntdApp>
                <WebToolsSettings />
            </AntdApp>
        </ConfigProvider>,
    )
}

/** 首台在线机器 m1 + tavily 已启用已设 key 的脱敏配置（两跳请求依次消费） */
function mockLoadConfig() {
    stableApi.machines.list.mockResolvedValueOnce({ data: { machines: [{ id: 'm1', active: true }] } })
    stableApi.machines.webTools.get.mockResolvedValueOnce({
        data: {
            config: {
                searchProviderId: 'tavily',
                providers: [
                    { id: 'tavily', enabled: true, timeoutMs: 15000, credentials: { apiKey: { set: true } } },
                    // timeoutMs 用非默认值，锁定"提交回传已加载超时，防整体替换重置为 schema 默认 15000"
                    { id: 'bocha', enabled: false, timeoutMs: 8000, credentials: { apiKey: { set: false } } },
                ],
            },
        },
    })
}

describe('WebToolsSettings', () => {
    beforeEach(() => {
        // mockReset：清掉上一用例的 mockResolvedValue/Once 队列，各用例自设响应
        stableApi.machines.list.mockReset()
        stableApi.machines.webTools.get.mockReset()
        stableApi.machines.webTools.set.mockReset()
    })
    afterEach(() => cleanup())

    it('加载并回显配置：tavily 启用且凭据已设置，bocha 未启用未设置', async () => {
        mockLoadConfig()
        renderCard()

        // 已设置（留空保持不变）extra 出现 = 配置回显完成
        await waitFor(() => expect(screen.getByText(/已设置（留空保持不变）/)).toBeTruthy())
        // tavily Switch 选中、bocha 未选中（aria-label 定位，不依赖 DOM 顺序）
        expect(screen.getByRole('switch', { name: 'tavily' })).toHaveClass('ant-switch-checked')
        expect(screen.getByRole('switch', { name: 'bocha' })).not.toHaveClass('ant-switch-checked')
        // 未启用 provider 的凭据显示"未设置"
        expect(screen.getByText('未设置')).toBeTruthy()
        // 两跳请求的入参
        expect(stableApi.machines.list).toHaveBeenCalledTimes(1)
        expect(stableApi.machines.webTools.get).toHaveBeenCalledWith('m1')
    })

    it('机器离线（502/网络异常）→ 显示离线提示', async () => {
        stableApi.machines.list.mockRejectedValue(new Error('offline'))
        renderCard()

        await waitFor(() => expect(screen.getByText(/机器离线/)).toBeTruthy())
        // 离线时不渲染 provider 配置块（无 Switch）
        expect(document.querySelector('.ant-switch')).toBeNull()
        expect(stableApi.machines.webTools.set).not.toHaveBeenCalled()
    })

    it('runner 读盘失败（error envelope）→ 显示错误而非离线提示', async () => {
        stableApi.machines.list.mockResolvedValue({ data: { machines: [{ id: 'm1', active: true }] } })
        stableApi.machines.webTools.get.mockResolvedValue({ data: { error: '读取 web 工具配置失败：EACCES' } })
        renderCard()

        await waitFor(() => expect(screen.getByText(/EACCES/)).toBeTruthy())
        // 与离线分支区分：不显示离线文案；不渲染配置块
        expect(screen.queryByText(/机器离线/)).toBeNull()
        expect(document.querySelector('.ant-switch')).toBeNull()
    })

    it('保存提交正确 payload：machineId 正确，凭据本次填写值原样提交（bocha 留空 = 空串）', async () => {
        mockLoadConfig()
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: true } })
        const { container } = renderCard()

        await waitFor(() => expect(screen.getByText(/已设置（留空保持不变）/)).toBeTruthy())

        // tavily 的 apiKey 输入（第一个密码框；bocha 为第二个）
        const inputs = container.querySelectorAll('input.ant-input')
        expect(inputs).toHaveLength(2)
        fireEvent.change(inputs[0], { target: { value: 'tvly-new-key' } })

        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

        await waitFor(() => expect(stableApi.machines.webTools.set).toHaveBeenCalledTimes(1))
        const [machineId, config] = stableApi.machines.webTools.set.mock.calls[0] as [
            string,
            { searchProviderId?: string; providers: Array<{ id: string; enabled: boolean; timeoutMs: number; credentials: Record<string, string> }> },
        ]
        expect(machineId).toBe('m1')
        expect(config.searchProviderId).toBe('tavily')
        const tavily = config.providers.find((p) => p.id === 'tavily')
        const bocha = config.providers.find((p) => p.id === 'bocha')
        expect(tavily?.credentials.apiKey).toBe('tvly-new-key')
        // 未填写的凭据以空串提交——runner 侧 merge 语义：空 = 保持旧值不动
        expect(bocha?.credentials.apiKey).toBe('')
        expect(bocha?.enabled).toBe(false)
        // 超时非本页可编辑项：回传已加载值（bocha 8000），防 runner 整体替换时被重置为默认 15000
        expect(tavily?.timeoutMs).toBe(15000)
        expect(bocha?.timeoutMs).toBe(8000)
        // 保存成功 toast
        await waitFor(() => expect(screen.getByText('已保存')).toBeTruthy())
    })

    it('业务失败（200 envelope success:false）→ message.error 显示 error', async () => {
        mockLoadConfig()
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: false, error: 'provider "tavily" 缺少凭据：apiKey' } })
        renderCard()

        await waitFor(() => expect(screen.getByText(/已设置（留空保持不变）/)).toBeTruthy())
        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

        await waitFor(() => expect(screen.getByText(/缺少凭据/)).toBeTruthy())
    })

    it('无任何 provider 配置 → 显示未配置提示', async () => {
        stableApi.machines.list.mockResolvedValueOnce({ data: { machines: [{ id: 'm1', active: true }] } })
        stableApi.machines.webTools.get.mockResolvedValueOnce({ data: { config: {} } })
        renderCard()

        await waitFor(() => expect(screen.getByText(/未配置/)).toBeTruthy())
    })
})
