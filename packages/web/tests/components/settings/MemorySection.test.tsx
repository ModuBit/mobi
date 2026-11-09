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
    'settings.memory.savedHint': '已保存 · 下个新会话生效',
    'settings.memory.endpointLabel': 'API 地址',
    'settings.memory.offMachineWarning': '数据将离开本机：记忆会写入远端服务，请确认你信任该 endpoint',
    'settings.memory.endpointRequired': '开启记忆需要先填写 API 地址',
    'settings.memory.endpointInvalid': 'API 地址无效：需要带协议的完整 URL（如 http://localhost:9999）',
    'settings.memory.tokenLabel': 'API Token',
    'settings.memory.tokenSetPlaceholder': '已设置 · 留空保持不变',
    'settings.memory.tokenUnsetPlaceholder': '粘贴 API Token（可选）',
    'settings.memory.tokenClear': '清除已存 Token',
    'settings.memory.tokenCleared': 'Token 已清除',
    'settings.memory.clear': '清除',
    'settings.memory.mapTitle': '记忆隔离',
    'settings.memory.mapHint': '按工作区设置记忆隔离档位',
    'settings.memory.ruleAddWorkspace': '选择工作区添加规则',
    'settings.memory.ruleAddPath': '按路径添加（高级）',
    'settings.memory.rulePathPlaceholder': '目录路径（如 ~/notes）',
    'settings.memory.add': '添加',
    'settings.memory.modeNormal': '独立记忆',
    'settings.memory.modeOpen': '完全共享',
    'settings.memory.modeIsolated': '完全隔离',
    'settings.memory.modeNormalHint': '各项目独立记忆',
    'settings.memory.modeOpenHint': '召回不过滤、全局可见',
    'settings.memory.modeIsolatedHint': '独立记忆库',
    'settings.memory.tagLabel': '共享组名',
    'settings.memory.bankLabel': '隔离库名',
    'settings.memory.bankNameLabel': '全局记忆库名',
    'settings.memory.bankNamePlaceholder': 'mobi-global',
    'settings.memory.ruleRemove': '删除该规则',
    'settings.memory.excludedTitle': '按工作区关闭',
    'settings.memory.excludedHint': '命中的工作区不挂载记忆',
    'settings.memory.excludedPlaceholder': '选择或输入要排除的目录',
    'settings.memory.statusTitle': '连接状态',
    'settings.memory.checkButton': '检查连接',
    'settings.memory.checkOk': '可达（{{ms}}ms）',
    'settings.memory.checkUnreachable': '不可达：服务未起或地址错误',
    'settings.memory.checkUnauthorized': '鉴权失败：Token 错误',
    'settings.memory.openUi': '打开记忆界面',
    'settings.memory.saveFailed': '保存失败',
    'settings.memory.loadFailed': '记忆设置加载失败，请确认 daemon 可达后重试',
    'settings.memory.injectTitle': '自动注入',
    'settings.memory.injectHint': '每轮自动把记忆注入上下文的方式',
    'settings.memory.injectModeLabel': '注入模式',
    'settings.memory.injectReflect': '每轮合成',
    'settings.memory.injectRecall': '直接注入检索结果',
    'settings.memory.injectPages': '仅注入目录',
    'settings.memory.injectNone': '不自动注入',
    'settings.memory.pageRefreshLabel': '知识页目录刷新间隔（轮）',
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

import { MemorySection } from '@/features/settings/sections/MemorySection'
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
        // 无 scheme 输入：WHATWG URL 不抛错但 hostname 为空，不生成坏链接（localhost://:9999）
        expect(deriveMemoryUiUrl('localhost:9999')).toBeNull()
    })

    it('isOffMachineEndpoint：非本机主机 → true；localhost/非法/无 scheme → false', () => {
        expect(isOffMachineEndpoint('https://api.example.com')).toBe(true)
        expect(isOffMachineEndpoint('http://localhost:8080')).toBe(false)
        expect(isOffMachineEndpoint('http://127.0.0.1:8080')).toBe(false)
        expect(isOffMachineEndpoint('garbage')).toBe(false)
        // 无 scheme：解析不出 hostname，不误报「数据出本机」
        expect(isOffMachineEndpoint('localhost:9999')).toBe(false)
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

    it('加载失败（daemon 不可达）：不按空默认初始化草稿（无表单可编辑），显示加载失败提示', async () => {
        stableApi.memory.get.mockRejectedValue(new Error('network down'))
        renderSection()

        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.loadFailed'])).toBeInTheDocument())
        // 表单不渲染——防「空草稿一次保存覆写已存配置」
        expect(screen.queryByLabelText('API 地址')).not.toBeInTheDocument()
    })

    it('引擎切换即改即存：off → Hindsight 动作即落盘（部分字段提交）', async () => {
        stableApi.memory.get.mockResolvedValue({ data: { settings: { apiTokenSet: false } } })
        stableApi.memory.set.mockResolvedValue({ data: { settings: { apiTokenSet: false } } })
        renderSection()
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.privacyHint'])).toBeInTheDocument())

        // uiarc Select：pointerDown(mouse) 展开、click 选中
        fireEvent.pointerDown(screen.getByLabelText(i18nMap['settings.memory.engineTitle']), { button: 0, pointerType: 'mouse' })
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.engineHindsight'])).toBeInTheDocument())
        fireEvent.click(screen.getByText(i18nMap['settings.memory.engineHindsight']))

        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ engine: 'hindsight' }))
        // hindsight 态展开：endpoint/token 行出现，description 换生效提示
        expect(screen.getByLabelText('API 地址')).toBeInTheDocument()
        expect(screen.getByText(i18nMap['settings.memory.savedHint'])).toBeInTheDocument()
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
        // UI 链接：行 description 里的外链（a 标签），navigate 行整行也可点
        const uiLink = screen.getByText(/ui\.hindsight\.vectorize\.io/).closest('a')
        expect(uiLink).toHaveAttribute('href', 'https://ui.hindsight.vectorize.io')
    })

    it('endpoint 失焦落盘：改动才提交（部分字段）；回显值未动不发请求', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 未改动失焦：不发请求
        fireEvent.blur(screen.getByLabelText('API 地址'))
        expect(stableApi.memory.set).not.toHaveBeenCalled()

        // 改动后失焦：只提交 endpoint 字段
        fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://localhost:9090' } })
        fireEvent.blur(screen.getByLabelText('API 地址'))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ endpoint: 'http://localhost:9090' }))
    })

    it('endpoint 校验：清空或无协议 URL 失焦不落盘（草稿保持让用户改）', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 清空 → endpointRequired
        fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: '' } })
        fireEvent.blur(screen.getByLabelText('API 地址'))
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.endpointRequired'])).toBeInTheDocument())
        expect(stableApi.memory.set).not.toHaveBeenCalled()

        // 无协议 URL → endpointInvalid
        fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'localhost:9999' } })
        fireEvent.blur(screen.getByLabelText('API 地址'))
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.endpointInvalid'])).toBeInTheDocument())
        expect(stableApi.memory.set).not.toHaveBeenCalled()
    })

    it('token 失焦落盘：填写才携带（在场性=覆盖）；留空失焦不发请求（在场性=保持）', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API Token')).toBeInTheDocument())

        // 留空失焦：不携带、不请求
        fireEvent.blur(screen.getByLabelText('API Token'))
        expect(stableApi.memory.set).not.toHaveBeenCalled()

        // 填写后失焦：携带 token
        fireEvent.change(screen.getByLabelText('API Token'), { target: { value: 'tok-123' } })
        fireEvent.blur(screen.getByLabelText('API Token'))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ apiToken: 'tok-123' }))
    })

    it('隔离规则契约：workspace 选中即建规则（payload 携带）、档位切换即落盘（条件覆盖联动）', async () => {
        stableWorkspaces.data = [{ id: 'w-learn', name: '学习', folders: [{ path: '/x/learn' }] }]
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 添加 workspace 规则（默认 normal）——动作即落盘
        fireEvent.focus(screen.getByLabelText('选择工作区添加规则'))
        await waitFor(() => expect(screen.getAllByText('学习').length).toBeGreaterThan(0))
        fireEvent.click(screen.getAllByText('学习')[0])
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({
            rules: [{ target: { type: 'workspace', id: 'w-learn' }, mode: 'normal' }],
        }))

        // normal 档出现共享组名输入；切到 isolated → 共享组名消失、隔离库名出现，动作即落盘
        await waitFor(() => expect(screen.getByLabelText('共享组名')).toBeInTheDocument())
        // uiarc Select：pointerDown(mouse) 展开、click 选中
        fireEvent.pointerDown(screen.getByLabelText('记忆隔离'), { button: 0, pointerType: 'mouse' })
        await waitFor(() => expect(screen.getByText('完全隔离')).toBeInTheDocument())
        fireEvent.click(screen.getByText('完全隔离'))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({
            rules: [{ target: { type: 'workspace', id: 'w-learn' }, mode: 'isolated' }],
        }))
        await waitFor(() => expect(screen.getByLabelText('隔离库名')).toBeInTheDocument())
        expect(screen.queryByLabelText('共享组名')).not.toBeInTheDocument()
    })

    it('注入策略：注入模式切换即落盘；刷新间隔失焦整数化落盘', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        // 注入模式切换：动作即落盘（uiarc Select：pointerDown(mouse) 展开、click 选中）
        fireEvent.pointerDown(screen.getByLabelText(i18nMap['settings.memory.injectModeLabel']), { button: 0, pointerType: 'mouse' })
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.injectReflect'])).toBeInTheDocument())
        fireEvent.click(screen.getByText(i18nMap['settings.memory.injectReflect']))
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ autoInject: 'reflect' }))

        // 刷新间隔：失焦落盘，小数被整数化（Math.round 语义：2.5 → 3）
        const field = screen.getByLabelText(i18nMap['settings.memory.pageRefreshLabel'])
        fireEvent.change(field, { target: { value: '2.5' } })
        fireEvent.blur(field)
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ pageRefreshEveryTurns: 3 }))
    })

    it('刷新间隔：清空回落 0（从不刷新），不落 1（每轮）', async () => {
        // 已存非 0 值作基线：清空才有「落盘回落」可言（基线本就是 0 时清空无变化不落盘）
        stableApi.memory.get.mockResolvedValue({
            data: { settings: { engine: 'hindsight', endpoint: 'https://api.hindsight.vectorize.io', apiTokenSet: true, pageRefreshEveryTurns: 3 } },
        })
        renderSection()
        await waitFor(() => expect(screen.getByLabelText('API 地址')).toBeInTheDocument())

        const field = screen.getByLabelText(i18nMap['settings.memory.pageRefreshLabel'])
        expect((field as HTMLInputElement).value).toBe('3')
        fireEvent.change(field, { target: { value: '' } })
        fireEvent.blur(field)
        await waitFor(() => expect(stableApi.memory.set).toHaveBeenCalledWith({ pageRefreshEveryTurns: 0 }))
    })

    it('清除 token：提交空串（在场性=清除）', async () => {
        renderSection()
        await waitFor(() => expect(screen.getByText(i18nMap['settings.memory.tokenClear'])).toBeInTheDocument())
        fireEvent.click(screen.getByText(i18nMap['settings.memory.clear']))
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
