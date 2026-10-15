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

/**
 * ChatComposer 参数区 output style 切换器（OutputStyleSwitch）规格。
 *
 * - idle 可选：选中新值 → 弹确认框（/clear 清空上下文语义）→ 确认后 mutation 以
 *   { sessionId, style } 调用
 * - running / clear 进行中 / mutation pending：切换器 disabled；running 时外层
 *   title 提示结束后可切换
 * - 弹窗取消：mutation 不被调用
 * - 当前值：outputStyle 透传（runtimeState.outputStyle 为权威），undefined → 'default'
 * - availableStyles：init 上报的可选名，非内置名（如 my-style）追加为下拉项可切回；内置名去重
 *
 * Select 交互说明：底座是 morph-select（CompactHoverSelect 壳）——触发器是
 * role=combobox 的 button（click 展开），选项 portal 为 role=listbox/option；
 * 收起态 iconOnly 只渲染图标，下拉项恒完整（名称 + 描述）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from 'antd'
import '@testing-library/jest-dom/vitest'
import { OutputStyleSwitch } from '@/features/composer/OutputStyleSwitch'

// jsdom 无 matchMedia：morph 动效打桩成立即达（尺寸 spring 不必真跑）
vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

// mock mutation hook：模块级稳定引用（mock 对象跨渲染保持同一身份，避免 effect 无限循环）
const { mutateSpy, mutationMock } = vi.hoisted(() => {
    const mutateSpy = vi.fn()
    return { mutateSpy, mutationMock: { mutate: mutateSpy, isPending: false } }
})
vi.mock('@/core/data/hooks/mutations/useSwitchOutputStyle', () => ({
    useSwitchOutputStyle: () => mutationMock,
}))

// mock i18n：identity t，带 { label } 插值时返回 `key:label` 便于断言（initReactI18next 必须
// noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts && 'label' in opts ? `${key}:${String(opts.label)}` : key,
    }),
}))

// vitest 未开 globals，渲染型测试必须显式 cleanup，否则 DOM 跨用例累积
afterEach(() => {
    cleanup()
    mutateSpy.mockClear()
})

function renderSwitch(props: Partial<Parameters<typeof OutputStyleSwitch>[0]> = {}) {
    return render(
        <App>
            <OutputStyleSwitch sessionId="s1" {...props} />
        </App>,
    )
}

/** 触发器：morph 的 trigger button（搜索框也是 combobox，按标签名区分） */
function trigger(): HTMLElement {
    return screen.getAllByRole('combobox').find(el => el.tagName === 'BUTTON')!
}

/** 展开下拉并点击指定选项（morph：click 触发，选项按可访问名匹配） */
async function selectOption(optionText: string | RegExp) {
    fireEvent.click(trigger())
    fireEvent.click(await screen.findByRole('option', { name: optionText }))
}

describe('OutputStyleSwitch', () => {
    it('idle 可选：选中后弹确认框，确认 → mutation 以 { sessionId, style } 调用', async () => {
        renderSwitch()
        expect(trigger()).not.toBeDisabled()

        await selectOption(/Explanatory/)

        // 确认框：标题 + 带选中项 label 的说明（/clear 语义）
        await waitFor(() => {
            const title = document.querySelector('.ant-modal-title')
            expect(title?.textContent).toBe('composer.outputStyleSwitchTitle')
        })
        expect(document.querySelector('.ant-modal-body')?.textContent)
            .toContain('composer.outputStyleSwitchConfirm:Explanatory')

        const modals = document.querySelectorAll('.ant-modal')
        const btn = modals[modals.length - 1].querySelector('.ant-modal-confirm-btns .ant-btn-primary')
        fireEvent.click(btn!)
        expect(mutateSpy).toHaveBeenCalledWith({ sessionId: 's1', style: 'Explanatory' })
    })

    it('running 时 disabled，外层 title 提示结束后可切换', () => {
        renderSwitch({ running: true })
        expect(trigger()).toBeDisabled()
        const wrapper = trigger().closest('span[title]')
        expect(wrapper).toHaveAttribute('title', 'composer.outputStyleRunningDisabled')
    })

    it('/clear 进行中（clearInProgress）同样 disabled', () => {
        renderSwitch({ clearInProgress: true })
        expect(trigger()).toBeDisabled()
    })

    it('弹窗取消 → mutation 未被调用', async () => {
        renderSwitch()
        await selectOption(/Explanatory/)
        await waitFor(() => {
            expect(document.querySelector('.ant-modal-title')?.textContent).toBe('composer.outputStyleSwitchTitle')
        })

        const modals = document.querySelectorAll('.ant-modal')
        const btn = modals[modals.length - 1]
            .querySelector('.ant-modal-confirm-btns .ant-btn:not(.ant-btn-primary)')
        fireEvent.click(btn!)
        await waitFor(() => {
            expect(mutateSpy).not.toHaveBeenCalled()
        })
    })

    it('收起态仅图标（iconOnly）；下拉项仍按名称+描述完整渲染', async () => {
        renderSwitch({ outputStyle: 'Learning' })
        // iconOnly 后触发器只渲染图标 + srOnly 可访问名（srOnly 文本不进可见 textContent 之外，
        // 但仍是文本节点，这里断言图标存在即可）
        expect(trigger().querySelector('svg')).not.toBeNull()

        // 展开下拉：选项按名称 + 描述渲染
        fireEvent.click(trigger())
        expect(await screen.findByRole('option', { name: /Learning/ })).toBeInTheDocument()
    })

    it('availableStyles 含自定义名（如 my-style）→ 下拉追加该项，可被选中', async () => {
        // 内置名（规范形 Proactive）已在基础列表 → 去重不追加；仅追加非内置的 my-style
        renderSwitch({ availableStyles: ['default', 'Proactive', 'my-style'] })

        fireEvent.click(trigger())
        expect(await screen.findByRole('option', { name: /my-style/ })).toBeInTheDocument()
        // 内置五项 + 自定义 my-style = 6
        expect(screen.getAllByRole('option')).toHaveLength(6)

        // 自定义项可被选中并走确认流程（原名直出，无 i18n label）
        fireEvent.click(screen.getByRole('option', { name: /my-style/ }))
        await waitFor(() => {
            expect(document.querySelector('.ant-modal-body')?.textContent)
                .toContain('composer.outputStyleSwitchConfirm:my-style')
        })
    })

    it('availableStyles 为 undefined 或全为内置名 → 下拉只有内置五项', async () => {
        renderSwitch({ availableStyles: undefined })
        fireEvent.click(trigger())
        await waitFor(() => {
            expect(screen.getAllByRole('option')).toHaveLength(5)
        })
        cleanup()

        renderSwitch({ availableStyles: ['default', 'Concise'] })
        fireEvent.click(trigger())
        await waitFor(() => {
            expect(screen.getAllByRole('option')).toHaveLength(5)
        })
        expect(screen.queryByRole('option', { name: /my-style/ })).not.toBeInTheDocument()
    })
})
