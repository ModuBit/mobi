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
 * Select 交互说明：antd v6 的 DOM 结构与 v5 不同——选中值在 `.ant-select-content`
 * （无 .ant-select-selection-item），展开用 fireEvent.mouseDown(`.ant-select`)，选项
 * portal 到 body 后按文本点击（组件侧 virtual={false} 保证选项同步渲染）。
 */

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from 'antd'
import '@testing-library/jest-dom/vitest'
import { OutputStyleSwitch } from '@/components/composer/OutputStyleSwitch'

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

// jsdom 无 ResizeObserver / matchMedia，antd Select 弹层路径依赖——最小 stub
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
const origResizeObserver = globalThis.ResizeObserver
const origMatchMedia = globalThis.matchMedia
beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    globalThis.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof matchMedia
})
afterAll(() => {
    globalThis.ResizeObserver = origResizeObserver
    globalThis.matchMedia = origMatchMedia
})

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

/** 展开下拉并点击指定选项（antd v6：mouseDown 触发在 .ant-select 根上） */
async function selectOption(optionText: string) {
    fireEvent.mouseDown(document.querySelector('.ant-select')!)
    const option = await screen.findByText(optionText)
    fireEvent.click(option)
}

/** 弹窗按钮容器为 .ant-modal-confirm-btns（confirm 弹窗无 .ant-modal-footer）；
 * v6 confirm 有重复节点 + 上个用例的关闭动画残留，取 body 中最后一份 modal——最新触发的确认框 */
function modalButton(primary: boolean): HTMLElement {
    const modals = document.querySelectorAll('.ant-modal')
    const modal = modals[modals.length - 1]
    if (!(modal instanceof HTMLElement)) throw new Error('modal not found')
    const selector = primary
        ? '.ant-modal-confirm-btns .ant-btn-primary'
        : '.ant-modal-confirm-btns .ant-btn:not(.ant-btn-primary)'
    const btn = modal.querySelector(selector)
    if (!(btn instanceof HTMLElement)) throw new Error(`modal button not found: ${selector}`)
    return btn
}

/** 确认弹窗出现且标题/说明正确（v6 confirm 存在重复渲染节点，用 querySelector 断言首份） */
async function expectConfirmDialog(label: string) {
    await waitFor(() => {
        const title = document.querySelector('.ant-modal-title')
        expect(title?.textContent).toBe('composer.outputStyleSwitchTitle')
    })
    expect(document.querySelector('.ant-modal-body')?.textContent)
        .toContain(`composer.outputStyleSwitchConfirm:${label}`)
}

describe('OutputStyleSwitch', () => {
    it('idle 可选：选中后弹确认框，确认 → mutation 以 { sessionId, style } 调用', async () => {
        renderSwitch()
        const root = document.querySelector('.ant-select')!
        expect(root).not.toHaveClass('ant-select-disabled')

        await selectOption('Explanatory')

        // 确认框：标题 + 带选中项 label 的说明（/clear 语义）
        await expectConfirmDialog('Explanatory')

        fireEvent.click(modalButton(true))
        expect(mutateSpy).toHaveBeenCalledWith({ sessionId: 's1', style: 'Explanatory' })
    })

    it('running 时 disabled，外层 title 提示结束后可切换', () => {
        renderSwitch({ running: true })
        expect(document.querySelector('.ant-select')).toHaveClass('ant-select-disabled')
        const wrapper = document.querySelector('.ant-select')?.parentElement
        expect(wrapper).toHaveAttribute('title', 'composer.outputStyleRunningDisabled')
    })

    it('/clear 进行中（clearInProgress）同样 disabled', () => {
        renderSwitch({ clearInProgress: true })
        expect(document.querySelector('.ant-select')).toHaveClass('ant-select-disabled')
    })

    it('弹窗取消 → mutation 未被调用', async () => {
        renderSwitch()
        await selectOption('Explanatory')
        await expectConfirmDialog('Explanatory')

        fireEvent.click(modalButton(false))
        await waitFor(() => {
            expect(mutateSpy).not.toHaveBeenCalled()
        })
    })

    it('当前值显示：outputStyle 透传选中 label；undefined → Default', () => {
        // antd v6 选中值渲染在 .ant-select-content（title 为选中 label）
        const { unmount } = renderSwitch({ outputStyle: 'Learning' })
        expect(document.querySelector('.ant-select-content')?.textContent).toBe('Learning')
        expect(document.querySelector('.ant-select-content')).toHaveAttribute('title', 'Learning')
        unmount()

        renderSwitch()
        expect(document.querySelector('.ant-select-content')?.textContent).toBe('Default')
    })

    /** 展开下拉（不选），返回当前展开的选项元素列表 */
    async function openDropdown(): Promise<NodeListOf<Element>> {
        fireEvent.mouseDown(document.querySelector('.ant-select')!)
        await waitFor(() => {
            expect(document.querySelectorAll('.ant-select-item-option')).not.toHaveLength(0)
        })
        return document.querySelectorAll('.ant-select-item-option')
    }

    it('availableStyles 含自定义名（如 my-style）→ 下拉追加该项，可被选中', async () => {
        // 内置名（规范形 Proactive）已在基础列表 → 去重不追加；仅追加非内置的 my-style
        renderSwitch({ availableStyles: ['default', 'Proactive', 'my-style'] })

        const options = await openDropdown()
        // 内置五项 + 自定义 my-style = 6
        expect(options).toHaveLength(6)
        expect(screen.getByText('my-style')).toBeInTheDocument()

        // 自定义项可被选中并走确认流程（原名直出，无 i18n label）
        fireEvent.click(screen.getByText('my-style'))
        await expectConfirmDialog('my-style')
    })

    it('availableStyles 为 undefined 或全为内置名 → 下拉只有内置五项', async () => {
        const { unmount } = renderSwitch({ availableStyles: undefined })
        expect(await openDropdown()).toHaveLength(5)
        unmount()
        cleanup()

        renderSwitch({ availableStyles: ['default', 'Concise'] })
        expect(await openDropdown()).toHaveLength(5)
        expect(screen.queryByText('my-style')).not.toBeInTheDocument()
    })
})
