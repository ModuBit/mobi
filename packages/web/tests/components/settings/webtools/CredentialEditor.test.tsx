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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App as AntdApp, ConfigProvider } from 'antd'

// i18n：key 恒等返回（按钮 name 即 key 文本），仅 verifyOk 需要 {{ms}} 插值走映射
const i18nMap = vi.hoisted(() => ({
    'settings.webTools.verifyOk': '验证通过（{{ms}}ms）',
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

import { CredentialEditor } from '@/components/settings/webtools/CredentialEditor'

const provider = {
    id: 'tavily' as const,
    enabled: true,
    timeoutMs: 15_000,
    credentials: { apiKey: { set: true, preview: 'tvly-******56' } },
}

function renderEditor(overrides?: { onSave?: ReturnType<typeof vi.fn>; onVerify?: ReturnType<typeof vi.fn> }) {
    const onSave = overrides?.onSave ?? vi.fn(async () => true)
    const onVerify = overrides?.onVerify ?? vi.fn(async () => ({ success: true, latencyMs: 42 }) as const)
    render(
        <ConfigProvider><AntdApp>
            <CredentialEditor provider={provider} onSave={onSave} onVerify={onVerify} />
        </AntdApp></ConfigProvider>,
    )
    return { onSave, onVerify }
}

afterEach(() => cleanup())

describe('CredentialEditor（预览态 → 编辑态 → 在场性提交）', () => {
    it('默认只读预览态：显示 preview，输入框 readonly，无保存/验证按钮，有「替换」', () => {
        renderEditor()
        const input = screen.getByDisplayValue('tvly-******56') as HTMLInputElement
        expect(input.readOnly).toBe(true)
        expect(screen.queryByRole('button', { name: 'settings.webTools.save' })).toBeNull()
        expect(screen.getByRole('button', { name: 'settings.webTools.replace' })).toBeTruthy()
    })
    it('预览态点「替换」→ 清空进入编辑态', () => {
        renderEditor()
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        const input = screen.getByLabelText('settings.webTools.apiKey') as HTMLInputElement
        expect(input.value).toBe('')
        expect(input.readOnly).toBe(false)
    })
    it('编辑新值 → 保存提交 { apiKey: 新值 }（在场性：只带编辑键）', async () => {
        const { onSave } = renderEditor()
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'tvly-newkey123456' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.save' }))
        await waitFor(() => { expect(onSave).toHaveBeenCalledWith({ apiKey: 'tvly-newkey123456' }) })
    })
    it('编辑后取消 → 恢复预览态（preview 复现、readonly）', () => {
        renderEditor()
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'x' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.cancel' }))
        expect((screen.getByDisplayValue('tvly-******56') as HTMLInputElement).readOnly).toBe(true)
    })
    it('验证连接：草稿值参与（≠preview 且非空）、显示耗时结果', async () => {
        const { onVerify } = renderEditor()
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'tvly-draft-key' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.verify' }))
        await waitFor(() => { expect(onVerify).toHaveBeenCalledWith({ apiKey: 'tvly-draft-key' }) })
        await waitFor(() => { expect(screen.getByText(/42/)).toBeTruthy() })
    })
    it('验证失败 → 显示错误文案', async () => {
        renderEditor({ onVerify: vi.fn(async () => ({ success: false, error: 'Invalid API key' })) })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        // 空草稿下验证按钮禁用，需输入后才可发起
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'tvly-bad' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.verify' }))
        await waitFor(() => { expect(screen.getByText('Invalid API key')).toBeTruthy() })
    })
    it('未设置凭据（set:false）：直接编辑态，无预览无「替换」', () => {
        render(<ConfigProvider><AntdApp>
            <CredentialEditor
                provider={{ ...provider, credentials: { apiKey: { set: false } } }}
                onSave={vi.fn(async () => true)}
                onVerify={vi.fn(async () => ({ success: true, latencyMs: 1 }))}
            />
        </AntdApp></ConfigProvider>)
        const input = screen.getByLabelText('settings.webTools.apiKey') as HTMLInputElement
        expect(input.value).toBe('')
        expect(input.readOnly).toBe(false)
        expect(screen.queryByRole('button', { name: 'settings.webTools.replace' })).toBeNull()
    })
    it('空输入禁用保存/验证：进入编辑态未输入两按钮 disabled，输入后 enabled', () => {
        renderEditor()
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))

        // 「替换」清空后未输入：无可提交的凭据变更——保存（防空串静默保持旧值却报「已保存」）与验证（防空凭据 RPC）一并禁用
        expect(screen.getByRole('button', { name: 'settings.webTools.save' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'settings.webTools.verify' })).toBeDisabled()

        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'tvly-k' } })
        expect(screen.getByRole('button', { name: 'settings.webTools.save' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'settings.webTools.verify' })).toBeEnabled()
    })
    it('保存成功退出编辑态后 reload 重读 preview：输入框跟随新 preview（不残留明文草稿）', async () => {
        const onSave = vi.fn(async () => true)
        const { rerender } = render(
            <ConfigProvider><AntdApp>
                <CredentialEditor provider={provider} onSave={onSave} onVerify={vi.fn(async () => ({ success: true, latencyMs: 1 }))} />
            </AntdApp></ConfigProvider>,
        )
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'tvly-plainsecret' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.save' }))
        await waitFor(() => { expect(onSave).toHaveBeenCalledWith({ apiKey: 'tvly-plainsecret' }) })

        // Section reload 后 provider 换新 preview（组件不重挂载）：预览态输入框必须显示新掩码串而非明文草稿
        const reloaded = { ...provider, credentials: { apiKey: { set: true, preview: 'tvly-******99' } } }
        rerender(
            <ConfigProvider><AntdApp>
                <CredentialEditor provider={reloaded} onSave={onSave} onVerify={vi.fn(async () => ({ success: true, latencyMs: 1 }))} />
            </AntdApp></ConfigProvider>,
        )
        const input = screen.getByDisplayValue('tvly-******99') as HTMLInputElement
        expect(input.readOnly).toBe(true)
        expect(screen.queryByDisplayValue('tvly-plainsecret')).toBeNull()
    })
    it('保存失败（onSave false）→ 不弹 error toast（上层负责）、保持编辑态', async () => {
        const { onSave } = renderEditor({ onSave: vi.fn(async () => false) })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.replace' }))
        fireEvent.change(screen.getByLabelText('settings.webTools.apiKey'), { target: { value: 'k2' } })
        fireEvent.click(screen.getByRole('button', { name: 'settings.webTools.save' }))
        await waitFor(() => { expect(onSave).toHaveBeenCalled() })
        // 仍处编辑态（输入框可编辑、值保留）
        const input = screen.getByLabelText('settings.webTools.apiKey') as HTMLInputElement
        expect(input.readOnly).toBe(false)
        expect(input.value).toBe('k2')
    })
})
