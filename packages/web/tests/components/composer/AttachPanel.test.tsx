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
 * AttachPanel 测试：面板项构成（PC / 移动端分流）与选项回调。
 * useIsMobile 以 hoisted mock 控制（真实 matchMedia 在 jsdom 不可用）；
 * i18n 以 identity t mock（文案断言用 key）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AttachPanel } from '@/features/composer/AttachPanel'

const mocks = vi.hoisted(() => ({ isMobile: false }))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => mocks.isMobile,
}))

// identity t：文案断言直接用 i18n key（initReactI18next 必须 noop 导出，避免顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))

/** 断言用的 i18n key（面板项标题） */
const FILE_ITEM = 'composer.attachFile'
const PHOTO_ITEM = 'composer.attachPhoto'
const RECORD_ITEM = 'composer.attachRecord'
const SKETCH_ITEM = 'sketch.open'

function renderPanel(overrides: Partial<Parameters<typeof AttachPanel>[0]> = {}) {
    const onAttach = vi.fn()
    const onSketch = vi.fn()
    const view = render(
        <AttachPanel onAttach={onAttach} onSketch={onSketch} {...overrides} />,
    )
    return { view, onAttach, onSketch }
}

/** 点开面板（Radix 在 pointerdown 上开合、click 打不开）；已打开时保持打开，
 *  因为触发器是开合切换——再点一次会关掉 */
function openPanel() {
    if (screen.queryByRole('menu')) return
    fireEvent.pointerDown(screen.getByTestId('attach-trigger'), { button: 0 })
    expect(screen.getByRole('menu')).toBeTruthy()
}

/** 选一项：菜单项选中即关，故每次动作前重新打开 */
function pick(text: string) {
    openPanel()
    fireEvent.click(screen.getByText(text))
}

describe('AttachPanel', () => {
    afterEach(cleanup)

    beforeEach(() => {
        mocks.isMobile = false
    })

    it('PC：文件 + 画板两项（无相机行），点击触发对应回调', () => {
        const { onAttach, onSketch } = renderPanel()
        openPanel()

        expect(screen.queryByText(PHOTO_ITEM)).toBeNull()
        expect(screen.queryByText(RECORD_ITEM)).toBeNull()

        pick(FILE_ITEM)
        expect(onAttach).toHaveBeenCalledWith('file')
        expect(onSketch).not.toHaveBeenCalled()

        pick(SKETCH_ITEM)
        expect(onSketch).toHaveBeenCalledTimes(1)
        expect(onAttach).toHaveBeenCalledTimes(1)
    })

    it('选中后菜单自动关闭（原 pick() 手写 setOpen 已随迁移删除）', () => {
        renderPanel()
        pick(FILE_ITEM)
        // 菜单不再留在 DOM 里（Radix 选中即关）
        expect(screen.queryByRole('menu')).toBeNull()
        expect(screen.queryByText(SKETCH_ITEM)).toBeNull()
    })

    it('移动端：相机行并排拍照/录像两项，回调 source 分别为 photo/video', () => {
        mocks.isMobile = true
        const { onAttach } = renderPanel()

        pick(PHOTO_ITEM)
        expect(onAttach).toHaveBeenCalledWith('photo')

        pick(RECORD_ITEM)
        expect(onAttach).toHaveBeenCalledWith('video')
    })

    it('移动端：相机行点完也关面板（相机行是 content 非 menuitem，Radix 不会自动关）', () => {
        mocks.isMobile = true
        renderPanel()

        pick(PHOTO_ITEM)
        expect(screen.queryByRole('menu')).toBeNull()
    })

    it('未提供 onSketch：不渲染画板项（新建页面板形态）', () => {
        render(<AttachPanel onAttach={vi.fn()} />)
        openPanel()
        expect(screen.queryByText(SKETCH_ITEM)).toBeNull()
    })
})
