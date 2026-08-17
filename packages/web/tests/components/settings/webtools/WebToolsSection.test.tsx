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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// 稳定引用（模块级单例）：useMobiApi 每次渲染返回同一对象，避免 effect 无限循环（worker OOM 前车之鉴）
const stableApi = {
    machines: {
        list: vi.fn(),
        webTools: { get: vi.fn(), set: vi.fn(), verify: vi.fn() },
    },
}

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))

// i18n：key → 断言用中文文案（与 locales zh.json 对齐的最小子集），支持 {{tools}} 插值
const i18nMap = vi.hoisted(() => ({
    'settings.webTools.routeTitle': '用途路由 · 可直接调整',
    'settings.webTools.route.search': '搜索',
    'settings.webTools.route.fetch': '抓取',
    'settings.webTools.routePlaceholder': '选择 provider',
    'settings.webTools.routeEmptyHint': '先在下方启用一个 provider 并配置凭据，再回到这里选择路由',
    'settings.webTools.routeHint': '配置保存于目标机器 · 新会话即时生效',
    'settings.webTools.providersTitle': 'PROVIDERS',
    'settings.webTools.providers.tavily': 'Tavily',
    'settings.webTools.providerDesc.tavily': 'AI 搜索与网页抓取 · tavily.com',
    'settings.webTools.providerLogo.tavily': 'Tv',
    'settings.webTools.apiKey': 'API Key',
    'settings.webTools.credentialSet': '已设置',
    'settings.webTools.credentialUnset': '未设置',
    'settings.webTools.disableReferenced': '该 provider 正承担 {{tools}}，请先调整用途路由',
    'settings.webTools.storageHint': '启用的 provider 才出现在用途路由下拉中',
    'settings.webTools.saveFailed': '保存失败',
    'settings.webTools.offline': '机器离线，无法加载 Web 工具配置',
    'settings.webTools.loadFailed': '加载 Web 工具配置失败',
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, string>) => {
            let text = i18nMap[key] ?? key
            if (opts) {
                for (const [name, value] of Object.entries(opts)) {
                    text = text.replaceAll(`{{${name}}}`, value)
                }
            }
            return text
        },
    }),
}))

// RouteCard 真实渲染（保留渲染断言），另捕获 onChange 供路由变更用例稳定触发：
// 当前 provider 清单仅 tavily 一项，真实 Select 恒锁定（无可选项），走 UI 交互断言不了 onChange 路径
const routeState = vi.hoisted(() => ({ onChange: null as null | ((next: { searchProviderId?: 'tavily' | null; fetchProviderId?: 'tavily' | null }) => Promise<boolean>) }))
vi.mock('@/components/settings/webtools/RouteCard', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/settings/webtools/RouteCard')>()
    return {
        RouteCard: (props: import('@/components/settings/webtools/RouteCard').RouteCardProps) => {
            routeState.onChange = props.onChange
            return <actual.RouteCard {...props} />
        },
    }
})

// CredentialEditor（S9 占位）真实渲染（仍为 null），另捕获 onSave 供凭据保存用例稳定触发——
// 编辑器内容 S9 才实装，UI 路径尚不可达
const editorState = vi.hoisted(() => ({ onSave: null as null | ((credentials: Record<string, string>) => Promise<boolean>) }))
vi.mock('@/components/settings/webtools/CredentialEditor', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/settings/webtools/CredentialEditor')>()
    return {
        CredentialEditor: (props: import('@/components/settings/webtools/CredentialEditor').CredentialEditorProps) => {
            editorState.onSave = props.onSave
            return <actual.CredentialEditor {...props} />
        },
    }
})

import { WebToolsSection } from '@/components/settings/sections/WebToolsSection'

/** 渲染：QueryClientProvider（数据层 react-query）+ ConfigProvider + AntdApp（toast 可断言）；每渲染独立 QueryClient 防缓存串测 */
function renderSection() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>
                <AntdApp>
                    <WebToolsSection />
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

/** 首台在线机器 m1 + tavily 已启用已设 key 的脱敏配置（两跳请求依次消费；可重复消费供 reload） */
function mockLoadConfig(overrides?: { enabled?: boolean; searchProviderId?: 'tavily'; fetchProviderId?: 'tavily' }) {
    stableApi.machines.list.mockResolvedValue({ data: { machines: [{ id: 'm1', active: true }] } })
    stableApi.machines.webTools.get.mockResolvedValue({
        data: {
            config: {
                searchProviderId: overrides?.searchProviderId,
                fetchProviderId: overrides?.fetchProviderId,
                providers: [
                    // timeoutMs 用非默认值，锁定"提交回传已加载超时，防整体替换重置为 schema 默认 15000"
                    // preview 掩码串供编辑器只读预览态用例断言
                    { id: 'tavily', enabled: overrides?.enabled ?? true, timeoutMs: 8000, credentials: { apiKey: { set: true, preview: 'tvly-******56' } } },
                ],
            },
        },
    })
}

describe('WebToolsSection', () => {
    beforeEach(() => {
        // mockReset：清掉上一用例的 mockResolvedValue 队列与调用记录，各用例自设响应
        stableApi.machines.list.mockReset()
        stableApi.machines.webTools.get.mockReset()
        stableApi.machines.webTools.set.mockReset()
        stableApi.machines.webTools.verify.mockReset()
        routeState.onChange = null
        editorState.onSave = null
    })
    afterEach(() => cleanup())

    it('路由卡渲染：web_search / web_fetch 两行出现', async () => {
        mockLoadConfig({ searchProviderId: 'tavily', fetchProviderId: 'tavily' })
        renderSection()

        // 工具名 code pill 出现 = 路由卡两行渲染完成
        await waitFor(() => expect(screen.getByText('web_search')).toBeTruthy())
        expect(screen.getByText('web_fetch')).toBeTruthy()
        expect(screen.getByText('用途路由 · 可直接调整')).toBeTruthy()
        // providers 区与卡底 hint 同屏
        expect(screen.getByText('PROVIDERS')).toBeTruthy()
    })

    it('provider 卡：Tavily 名称 + API Key 已设置状态', async () => {
        mockLoadConfig()
        renderSection()

        // 名称 + 凭据状态（已设置）
        await waitFor(() => expect(screen.getByText('API Key 已设置')).toBeTruthy())
        expect(screen.getByText('Tavily')).toBeTruthy()
        expect(screen.getByText('AI 搜索与网页抓取 · tavily.com')).toBeTruthy()
        // Switch 选中
        expect(screen.getByRole('switch', { name: 'tavily-enabled' })).toHaveClass('ant-switch-checked')
    })

    it('点击卡头展开编辑器：aria-expanded 翻 true（S9 实装编辑器内容）', async () => {
        mockLoadConfig()
        renderSection()

        const head = await waitFor(() => screen.getByRole('button', { name: 'Tavily' }))
        expect(head).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(head)
        expect(head).toHaveAttribute('aria-expanded', 'true')
        // 再次点击收起
        fireEvent.click(head)
        expect(head).toHaveAttribute('aria-expanded', 'false')
    })

    it('编辑器展示 preview 只读态（S9 实装恢复）', async () => {
        mockLoadConfig()
        renderSection()

        // 点击卡头展开 → 编辑器渲染脱敏 preview（readonly，不可误编辑掩码串）
        const head = await waitFor(() => screen.getByRole('button', { name: 'Tavily' }))
        fireEvent.click(head)
        const input = screen.getByDisplayValue('tvly-******56') as HTMLInputElement
        expect(input.readOnly).toBe(true)
    })

    it('禁用被 search/fetch 引用的 provider 被拦截：提示且不发 RPC', async () => {
        mockLoadConfig({ enabled: true, searchProviderId: 'tavily', fetchProviderId: 'tavily' })
        renderSection()

        await waitFor(() => expect(screen.getByText('API Key 已设置')).toBeTruthy())
        fireEvent.click(screen.getByRole('switch', { name: 'tavily-enabled' }))

        // 拦截提示（用途名已本地化），且未提交
        await waitFor(() =>
            expect(screen.getByText('该 provider 正承担 搜索 / 抓取，请先调整用途路由')).toBeTruthy(),
        )
        expect(stableApi.machines.webTools.set).not.toHaveBeenCalled()
        // 开关仍选中
        expect(screen.getByRole('switch', { name: 'tavily-enabled' })).toHaveClass('ant-switch-checked')
    })

    it('启用未引用 provider：即时保存全量 providers（凭据键不在场=保持）并重读配置', async () => {
        // 未启用且未被路由引用 → 允许打开
        mockLoadConfig({ enabled: false })
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: true } })
        renderSection()

        await waitFor(() => expect(screen.getByRole('switch', { name: 'tavily-enabled' })).toBeTruthy())
        fireEvent.click(screen.getByRole('switch', { name: 'tavily-enabled' }))

        await waitFor(() => expect(stableApi.machines.webTools.set).toHaveBeenCalledTimes(1))
        const [machineId, config] = stableApi.machines.webTools.set.mock.calls[0] as [
            string,
            { providers: Array<{ id: string; enabled: boolean; timeoutMs: number; credentials: Record<string, unknown> }> },
        ]
        expect(machineId).toBe('m1')
        expect(config.providers).toEqual([{ id: 'tavily', enabled: true, timeoutMs: 8000, credentials: {} }])
        // 成功后 reload：两跳请求重跑（get 至少第二次）
        await waitFor(() => expect(stableApi.machines.webTools.get.mock.calls.length).toBeGreaterThanOrEqual(2))
    })

    it('路由变更即时保存：set 以含新 searchProviderId 的 config 调用，成功后重读', async () => {
        mockLoadConfig({ enabled: true, searchProviderId: 'tavily', fetchProviderId: 'tavily' })
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: true } })
        renderSection()

        await waitFor(() => expect(screen.getByText('web_search')).toBeTruthy())
        expect(routeState.onChange).toBeTruthy()
        // 通过捕获的 onChange 回调触发路由变更（真实 Select 单 provider 恒锁定，UI 路径不可达）
        await routeState.onChange!({ searchProviderId: 'tavily' })

        await waitFor(() => expect(stableApi.machines.webTools.set).toHaveBeenCalledTimes(1))
        const [machineId, config] = stableApi.machines.webTools.set.mock.calls[0] as [
            string,
            { searchProviderId?: string; fetchProviderId?: string; providers: unknown[] },
        ]
        expect(machineId).toBe('m1')
        expect(config.searchProviderId).toBe('tavily')
        // 未变更的 fetch 路由回填现值（整体替换语义）
        expect(config.fetchProviderId).toBe('tavily')
        // 成功后 reload：get 重读
        await waitFor(() => expect(stableApi.machines.webTools.get.mock.calls.length).toBeGreaterThanOrEqual(2))
    })

    it('凭据保存走 saveBase：set 实参回填 search/fetch 路由字段（防整体替换清空路由）', async () => {
        mockLoadConfig({ enabled: true, searchProviderId: 'tavily', fetchProviderId: 'tavily' })
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: true } })
        renderSection()

        // 展开编辑器（占位渲染 null，onSave 已被捕获）
        const head = await waitFor(() => screen.getByRole('button', { name: 'Tavily' }))
        fireEvent.click(head)
        expect(editorState.onSave).toBeTruthy()
        await editorState.onSave!({ apiKey: 'tvly-new-key' })

        await waitFor(() => expect(stableApi.machines.webTools.set).toHaveBeenCalledTimes(1))
        const [, config] = stableApi.machines.webTools.set.mock.calls[0] as [
            string,
            { searchProviderId?: string; fetchProviderId?: string; providers: Array<{ id: string; enabled: boolean; timeoutMs: number; credentials: Record<string, string | null> }> },
        ]
        // providers 整体替换语义：路由字段必须回填现值，否则保存凭据会静默清空路由
        expect(config.searchProviderId).toBe('tavily')
        expect(config.fetchProviderId).toBe('tavily')
        // 目标 provider 带编辑中的凭据键 + 现值 enabled/timeoutMs
        expect(config.providers).toEqual([
            { id: 'tavily', enabled: true, timeoutMs: 8000, credentials: { apiKey: 'tvly-new-key' } },
        ])
    })

    it('保存失败（success:false）：恰好一条 error toast 且透传 runner 原因（非通用文案），开关状态不变', async () => {
        // 已启用且未被路由引用 → 允许关闭；提交返回业务失败
        mockLoadConfig({ enabled: true })
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: false, error: 'provider "tavily" 缺少凭据：apiKey' } })
        renderSection()

        await waitFor(() => expect(screen.getByRole('switch', { name: 'tavily-enabled' })).toBeTruthy())
        fireEvent.click(screen.getByRole('switch', { name: 'tavily-enabled' }))

        // 失败提示恰好一条（Section 层收口）且带 runner 校验原因——支持性回归锁（旧 UI 有此能力）
        await waitFor(() => expect(screen.getByText('provider "tavily" 缺少凭据：apiKey')).toBeTruthy())
        expect(screen.queryAllByText('provider "tavily" 缺少凭据：apiKey')).toHaveLength(1)
        expect(screen.getByRole('switch', { name: 'tavily-enabled' })).toHaveClass('ant-switch-checked')
    })

    it('全部 provider 未启用：路由卡转引导态（无下拉、显示引导文案）', async () => {
        mockLoadConfig({ enabled: false })
        renderSection()

        await waitFor(() =>
            expect(screen.getByText('先在下方启用一个 provider 并配置凭据，再回到这里选择路由')).toBeTruthy(),
        )
        // 引导态不渲染路由下拉
        expect(screen.queryByRole('combobox')).toBeNull()
    })

    it('机器离线（get reject）→ offline Alert 呈现，不渲染配置区', async () => {
        stableApi.machines.list.mockResolvedValue({ data: { machines: [{ id: 'm1', active: true }] } })
        stableApi.machines.webTools.get.mockRejectedValue(new Error('offline'))
        renderSection()

        await waitFor(() => expect(screen.getByText('机器离线，无法加载 Web 工具配置')).toBeTruthy())
        expect(screen.queryByRole('switch', { name: 'tavily-enabled' })).toBeNull()
        expect(stableApi.machines.webTools.set).not.toHaveBeenCalled()
    })

    it('单 provider：路由行不锁定且可清除（allowClear）——teardown 流程（清路由 → 禁用 provider）畅通', async () => {
        // tavily 已启用；search 路由为空、fetch 路由已指向 tavily
        mockLoadConfig({ enabled: true, searchProviderId: undefined, fetchProviderId: 'tavily' })
        renderSection()

        await waitFor(() => expect(screen.getByText('web_search')).toBeTruthy())
        // 两行均不锁定：值非空的单 provider 行也可清除（旧版锁定会让路由永远设不上/撤不掉）
        for (const label of ['搜索', '抓取']) {
            expect(screen.getByRole('combobox', { name: label }).closest('.ant-select')).not.toHaveClass(
                'ant-select-disabled',
            )
        }
        // allowClear 生效：有值的行渲染清除按钮
        expect(screen.getByRole('combobox', { name: '抓取' }).closest('.ant-select')).toBeTruthy()
    })

    it('路由清除（null）：set payload 不含被清除的路由字段（区别于「未提及回填现值」）', async () => {
        mockLoadConfig({ enabled: true, searchProviderId: 'tavily', fetchProviderId: 'tavily' })
        stableApi.machines.webTools.set.mockResolvedValue({ data: { success: true } })
        renderSection()

        await waitFor(() => expect(screen.getByText('web_search')).toBeTruthy())
        expect(routeState.onChange).toBeTruthy()
        // 清除 fetch 路由：null 语义 → payload 只回填 search 现值，fetch 字段整体缺席（整体替换语义下即清除落盘）
        await routeState.onChange!({ fetchProviderId: null })

        await waitFor(() => expect(stableApi.machines.webTools.set).toHaveBeenCalledTimes(1))
        const [, config] = stableApi.machines.webTools.set.mock.calls[0] as [
            string,
            { searchProviderId?: string; fetchProviderId?: string; providers: unknown[] },
        ]
        expect(config.searchProviderId).toBe('tavily')
        expect('fetchProviderId' in config).toBe(false)
    })
})
