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
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { App as AntdApp } from 'antd'

// i18n 最小桩：只认兜底文案 key，其余原样返回
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => (key === 'test.saveFailed' ? '保存失败' : key) }),
}))

import { useSettingsDraft } from '@/features/settings/useSettingsDraft'

/** 测试设置形状：name（普通 blur 字段）+ secret（写后清空字段）+ refresh（带规范化字段） */
interface TestSettings {
    name?: string
    refresh?: number
}

function renderDraftHook(overrides?: {
    settings?: TestSettings
    loaded?: boolean
    save?: ReturnType<typeof vi.fn>
    buildPayload?: (key: string, draft: Record<string, unknown>, baseline: Record<string, unknown>) => unknown
    reportError?: (error: string, fallback: string) => void
}) {
    const save = overrides?.save ?? vi.fn().mockResolvedValue({ ok: true } as const)
    const buildPayload = overrides?.buildPayload
        ?? ((key: string, draft: Record<string, unknown>, baseline: Record<string, unknown>) => {
            // 默认纪律：secret 非空才携带；name 偏离基线才携带
            if (key === 'secret' && String(draft.secret).trim()) return { secret: draft.secret }
            if (key === 'name' && draft.name !== baseline.name) return { name: draft.name }
            return null
        })
    const reportError = overrides?.reportError

    const hook = renderHook(
        ({ settings, loaded }: { settings?: TestSettings; loaded?: boolean }) =>
            useSettingsDraft<Record<string, unknown>, TestSettings>({
                loaded: loaded ?? true,
                settings,
                errorFallbackKey: 'test.saveFailed',
                fields: {
                    name: { from: (s) => s?.name ?? '' },
                    secret: { from: () => '', onSaved: ({ reset }) => reset('') },
                    refresh: {
                        from: (s) => String(s?.refresh ?? 0),
                        normalize: (v) => String(Math.max(0, Math.round(Number(v) || 0))),
                    },
                },
                buildPayload: buildPayload as never,
                save: save as never,
                reportError,
            }),
        {
            initialProps: { settings: overrides?.settings, loaded: overrides?.loaded },
            wrapper: ({ children }) => <AntdApp>{children}</AntdApp>,
        },
    )
    return { hook, save, rerender: hook.rerender }
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('useSettingsDraft 纪律', () => {
    it('加载后投影一次初值；settings 重读（invalidate）不重置编辑中草稿', async () => {
        const { hook, rerender: rerenderDraft } = renderDraftHook({ settings: { name: 'saved-name' } })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('saved-name'))

        // 编辑草稿 → 模拟 invalidate 重读（同 loaded 下的新 settings 引用）
        act(() => hook.result.current.setDraft({ name: 'editing' }))
        rerenderDraft({ settings: { name: 'saved-name', refresh: 3 }, loaded: true })
        expect(hook.result.current.draft.name).toBe('editing')
    })

    it('未加载不投影；loaded 翻转后才投影', async () => {
        const { hook, rerender: rerenderDraft } = renderDraftHook({ settings: { name: 'saved-name' }, loaded: false })
        expect(hook.result.current.draft.name).toBe('')
        rerenderDraft({ settings: { name: 'saved-name' }, loaded: true })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('saved-name'))
    })

    it('未偏离基线的 commit 不落盘（buildPayload 返回 null 视为无事可做）', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({ settings: { name: 'saved-name' }, save })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('saved-name'))

        await act(() => hook.result.current.commit('name'))
        expect(save).not.toHaveBeenCalled()
    })

    it('偏离基线的 commit 落盘并推进基线；二次 commit 不再落盘', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({ settings: { name: 'saved-name' }, save })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('saved-name'))

        await act(() => hook.result.current.commit('name', { name: 'changed' }))
        expect(save).toHaveBeenCalledWith({ name: 'changed' })
        await act(() => hook.result.current.commit('name'))
        expect(save).toHaveBeenCalledTimes(1)
    })

    it('字段级校验失败（buildPayload 返回 {error}）：走 reportError、不落盘、草稿保持', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const reportError = vi.fn()
        const { hook } = renderDraftHook({
            save, reportError,
            buildPayload: (key, draft) => (key === 'name' && !String(draft.name).trim()
                ? { error: '名称必填' }
                : null),
        })
        await waitFor(() => expect(hook.result.current.draft.name).toBe(''))

        await act(() => hook.result.current.commit('name', { name: '' }))
        expect(reportError).toHaveBeenCalledWith('名称必填', '保存失败')
        expect(save).not.toHaveBeenCalled()
        expect(hook.result.current.draft.name).toBe('')
    })

    it('save 失败：reportError 收到 daemon error；未覆写时默认 message.error 兜底文案', async () => {
        const save = vi.fn().mockResolvedValue({ ok: false, error: 'daemon 原因' } as const)
        const reportError = vi.fn()
        const { hook } = renderDraftHook({ save, reportError })
        await waitFor(() => expect(hook.result.current.draft.name).toBe(''))

        await act(() => hook.result.current.commit('name', { name: 'x' }))
        expect(reportError).toHaveBeenCalledWith('daemon 原因', '保存失败')
    })

    it('onSaved 副作用：payload 携带该字段时 reset 同时重置草稿与基线（密钥写后清空）', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({
            save,
            buildPayload: (_key, draft) => (String(draft.secret).trim() ? { secret: draft.secret } : null),
        })

        await act(() => hook.result.current.commit('secret', { secret: 'tok-1' }))
        expect(save).toHaveBeenCalledWith({ secret: 'tok-1' })
        expect(hook.result.current.draft.secret).toBe('')
        // 基线也被重置：dirty 不残留
        expect(hook.result.current.dirty).toBe(false)
    })

    it('normalize 在提交时写回草稿（失焦整数化显示），规范化值参与 payload 判定', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({
            settings: { refresh: 3 },
            save,
            buildPayload: (_key, draft, baseline) => {
                const n = Math.round(Number(draft.refresh) || 0)
                return n === Number(baseline.refresh) ? null : { refresh: n }
            },
        })
        await waitFor(() => expect(hook.result.current.draft.refresh).toBe('3'))

        // 2.5 → 规范化为 3：显示更新、与基线相同不落盘（对齐 Memory 刷新间隔既有语义）
        await act(() => hook.result.current.commit('refresh', { refresh: '2.5' }))
        expect(hook.result.current.draft.refresh).toBe('3')
        expect(save).not.toHaveBeenCalled()
    })

    it('batch：无 key 的 commit 由 buildPayload 整组构造 payload', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({
            save,
            buildPayload: (_key, draft) => {
                const patch: Record<string, unknown> = {}
                if (String(draft.name).trim()) patch.name = draft.name
                if (String(draft.secret).trim()) patch.secret = draft.secret
                return patch
            },
        })

        // 全空 → 落盘空 patch（batch 语义：显式动作恒提交，由分区决定空 patch 意义）
        await act(() => hook.result.current.commit())
        expect(save).toHaveBeenCalledWith({})
        // 填写后 → 携带非空字段
        await act(() => hook.result.current.commit('', { name: 'k1', secret: 'tok' }))
        expect(save).toHaveBeenLastCalledWith({ name: 'k1', secret: 'tok' })
    })

    it('换名落盘（payload key ≠ 草稿字段名）同样推进基线：不重复提交、改回原值不再被 null 吞掉', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({
            settings: { name: 'saved-name' },
            save,
            // 模拟 MemorySection 的 pageRefresh 形态：草稿字段 name 落盘为换名 key savedName
            buildPayload: (_key, draft, baseline) =>
                draft.name !== baseline.name ? { savedName: draft.name } : null,
        })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('saved-name'))

        // 改 5 → 落盘成功后基线推进到 5：同值再 commit 不重复发请求
        await act(() => hook.result.current.commit('name', { name: 'five' }))
        expect(save).toHaveBeenCalledWith({ savedName: 'five' })
        await act(() => hook.result.current.commit('name'))
        expect(save).toHaveBeenCalledTimes(1)
        expect(hook.result.current.dirty).toBe(false)
        // 改回基线值 → 落盘（若基线未推进，这里会被「与基线相同 → null」吞掉，UI 与落盘值背离）
        await act(() => hook.result.current.commit('name', { name: 'saved-name' }))
        expect(save).toHaveBeenLastCalledWith({ savedName: 'saved-name' })
    })

    it('bindInput：value 受控、onChange 编辑、blur/回车以字段 key 提交', async () => {
        const save = vi.fn().mockResolvedValue({ ok: true } as const)
        const { hook } = renderDraftHook({ settings: { name: 'base' }, save })
        await waitFor(() => expect(hook.result.current.draft.name).toBe('base'))

        const input = hook.result.current.bindInput('name')
        expect(input.value).toBe('base')
        act(() => input.onChange({ target: { value: 'typed' } } as never))
        expect(hook.result.current.draft.name).toBe('typed')
        await act(() => input.onBlur())
        expect(save).toHaveBeenCalledWith({ name: 'typed' })
    })
})
