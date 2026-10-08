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
    memory: { get: vi.fn(), set: vi.fn(), check: vi.fn() },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))
// workspace 数据源（规则编辑契约用例注入）——类型别名单写，避免 .tsx 里
// `Array<{...}>` 字面量被 oxc 解析为 JSX 开标签
type WorkspaceStub = { id: string; name: string; folders: { path: string }[] }
const stableWorkspaces = vi.hoisted(() => ({ data: [] as WorkspaceStub[] }))
vi.mock('@/core/data/hooks/queries/useWorkspaces', () => ({
    useWorkspaces: () => ({ data: stableWorkspaces.data }),
}))

// i18n：key → 断言用中文文案（与 locales zh.json 对齐的最小子集），支持 {{xxx}} 插值
const i18nMap = vi.hoisted(() => ({
    'settings.memory.engineTitle': '记忆引擎',
    'settings.memory.engineOff': '关闭',
    'settings.memory.engineHindsight': 'Hindsight',
    'settings.memory.privacyHint': '记忆默认关闭 · 开启后对话中的关键信息会被提取并跨会话召回',
    'settings.memory.endpointLabel': 'API 地址',
    'settings.memory.offMachineWarning': '数据将离开本机：记忆会写入远端服务，请确认你信任该 endpoint',
    'settings.memory.endpointRequired': '开启记忆需要先填写 API 地址',
    'settings.memory.tokenLabel': 'API Token',
    'settings.memory.tokenSetPlaceholder': '已设置 · 留空保持不变',
    'settings.memory.tokenUnsetPlaceholder': '粘贴 API Token（可选）',
    'settings.memory.tokenClear': '清除已存 Token',
    'settings.memory.mapTitle': '记忆隔离',
    'settings.memory.ruleAddWorkspace': '选择工作区添加规则',
    'settings.memory.ruleAddPath': '按路径添加（高级）',
    'settings.memory.rulePathPlaceholder': '目录路径（如 ~/notes）',
    'settings.memory.modeNormal': '独立记忆',
    'settings.memory.modeOpen': '完全共享',
    'settings.memory.modeIsolated': '完全隔离',
    'settings.memory.tagLabel': '共享组名',
    'settings.memory.bankLabel': '隔离库名',
    'settings.memory.bankNameLabel': '全局记忆库名',
    'settings.memory.bankNamePlaceholder': 'mobi-global',
    'settings.memory.ruleRemove': '删除该规则',
    'settings.memory.excludedTitle': '按工作区关闭',
    'settings.memory.statusTitle': '连接状态',
    'settings.memory.checkButton': '检查连接',
    'settings.memory.checkOk': '可达（{{ms}}ms）',
    'settings.memory.checkUnreachable': '不可达：服务未起或地址错误',
    'settings.memory.checkUnauthorized': '鉴权失败：Token 错误',
    'settings.memory.openUi': '打开记忆界面',
    'settings.memory.saveButton': '保存',
    'settings.memory.savedHint': '已保存 · 下个新会话生效',
    'settings.memory.saveFailed': '保存失败',
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

import { MemorySection } from '@/components/settings/sections/MemorySection'
import { deriveMemoryUiUrl, isOffMachineEndpoint } from '@mobi/shared'

function renderSection() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={client}>
            <ConfigProvider>
                <AntdApp>
                    <MemorySection />
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})
afterEach(cleanup)

describe('纯函数：链接与出本机判定', () => {
    it('deriveMemoryUiUrl：Cloud → 官方 dashboard；self-host → 同主机 9999；非法 → null', () => {
        expect(deriveMemoryUiUrl('https://api.hindsight.vectorize.io')).toBe('https://ui.hindsight.vectorize.io')
        expect(deriveMemoryUiUrl('http://192.168.1.10:3456/api')).toBe('http://192.168.1.10:9999')
        expect(deriveMemoryUiUrl('')).toBeNull()
        expect(deriveMemoryUiUrl('not a url')).toBeNull()
    })

    it('isOffMachineEndpoint：非本机主机 → true；localhost/非法 → false', () => {
        expect(isOffMachineEndpoint('https://api.example.com')).toBe(true)
        expect(isOffMachineEndpoint('http://localhost:8080')).toBe(false)
        expect(isOffMachineEndpoint('http://127.0.0.1:8080')).toBe(false)
        expect(isOffMachineEndpoint('garbage')).toBe(false)
    })
})

describe('MemorySection 默认关闭态', () => {
    it('off 时渲染隐私引导文案，不渲染 endpoint/token 输入', async () => {
        stableApi.memory.get.mockResolvedValue({ data: { settings: { apiTokenSet: false } } })
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.privacyHint'])).toBeInTheDocument())
        expect(screen.queryByLabelText('API 地址')).not.toBeInTheDocument()
        expect(screen.queryByText(i18nMap['settings.memory.offMachineWarning'])).not.toBeInTheDocument()
    })
})

describe('MemorySection hindsight 开启态', () => {
    beforeEach(() => {
        stableApi.memory.get.mockResolvedValue({
            data: { settings: { engine: 'hindsight', endpoint: 'https://api.hindsight.vectorize.io', apiTokenSet: true } },
        })
        stableApi.memory.set.mockResolvedValue({ data: { settings: { engine: 'hindsight', apiTokenSet: true } } })
    })

    it('已存配置回显：Cloud endpoint 显示出本机警告与官方 UI 链接', async () => {
        renderSection()
        await waitFor(() => expect((screen.getByLabelText('API 地址') as HTMLInputElement).value)
            .toBe('https://api.hindsight.vectorize.io'))
        expect(screen.getByText(i18nMap['settings.memory.offMachineWarning'])).toBeInTheDocument()
        const uiLink = screen.getByText(i18nMap['settings.memory.openUi']).closest('a')
        expect(uiLink).toHaveAttribute('href', 'https://ui.hindsight.vectorize.io')
    })

    it('保存 payload：apiToken 留空不携带（在场性=保持）；填写则携带', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 留空保存
        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))  // antd 对两字 CJK 按钮自动插空格)
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalled())
        let payload = stableApi.memory.set.mock.calls[0][0]
        expect(payload.apiToken).toBeUndefined()
        expect(payload.engine).toBe('hindsight')
        expect(payload.rules).toEqual([])
        expect(payload.bankName).toBe('')
        expect(payload.disabledWorkspaces).toEqual([])

        // 填写后携带
        fireEvent.change(screen.getByLabelText('API Token'), { target: { value: 'tok-123' } })
        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))  // antd 对两字 CJK 按钮自动插空格)
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledTimes(2))
        payload = stableApi.memory.set.mock.calls[1][0]
        expect(payload.apiToken).toBe('tok-123')
    })

    it('隔离规则编辑契约：workspace 选择添加 → 档位切换出条件覆盖 → payload 携带', async () => {
        stableWorkspaces.data = [{ id: 'w-learn', name: '学习', folders: [{ path: '/x/learn' }] }]
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 添加 workspace 规则（默认 normal）
        fireEvent.mouseDown(screen.getByLabelText('选择工作区添加规则'))
        await waitFor(() => expect(screen.getByText('学习')).toBeInTheDocument())
        fireEvent.click(screen.getByText('学习'))
        await waitFor(() => expect(screen.getByLabelText('共享组名')).toBeInTheDocument())

        // 填共享组名
        fireEvent.change(screen.getByLabelText('共享组名'), { target: { value: 'learn' } })

        // 切到 isolated → 共享组名消失、隔离库名出现
        fireEvent.mouseDown(screen.getByLabelText('记忆隔离'))
        await waitFor(() => expect(screen.getByText('完全隔离')).toBeInTheDocument())
        fireEvent.click(screen.getByText('完全隔离'))
        await waitFor(() => expect(screen.queryByLabelText('共享组名')).not.toBeInTheDocument())
        await waitFor(() => expect(screen.getByLabelText('隔离库名')).toBeInTheDocument())
        fireEvent.change(screen.getByLabelText('隔离库名'), { target: { value: 'vault' } })

        // 全局库名覆盖
        fireEvent.change(screen.getByLabelText('全局记忆库名'), { target: { value: 'my-pool' } })

        // 保存 payload：规则与覆盖值形状正确
        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalled())
        const payload = stableApi.memory.set.mock.calls[0][0]
        expect(payload.rules).toEqual([
            { target: { type: 'workspace', id: 'w-learn' }, mode: 'isolated', bank: 'vault' },
        ])
        expect(payload.bankName).toBe('my-pool')
    })

    it('清除 token：提交空串（在场性=清除）', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.tokenClear'])).toBeInTheDocument())
        fireEvent.click(screen.getByText(i18nMap['settings.memory.tokenClear']))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ apiToken: '' }))
    })

    it('健康检查：unauthorized 结果展示 key 错文案', async () => {
        stableApi.memory.check.mockResolvedValue({ data: { status: 'unauthorized' } })
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: i18nMap['settings.memory.checkButton'] }))
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.checkUnauthorized'])).toBeInTheDocument())
        expect(stableApi.memory.check).toHaveBeenCalledWith({ endpoint: 'https://api.hindsight.vectorize.io' })
    })

    it('检查 ok：展示可达耗时', async () => {
        stableApi.memory.check.mockResolvedValue({ data: { status: 'ok', latencyMs: 42 } })
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: i18nMap['settings.memory.checkButton'] }))
        await waitFor(() => expect(screen.getByText('可达（42ms）')).toBeInTheDocument())
    })

    it('localhost endpoint 不显示数据出本机警告', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())
        fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://localhost:9090' } })
        expect(screen.queryByText(i18nMap['settings.memory.offMachineWarning'])).not.toBeInTheDocument()
    })
})
