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
 * 设置页调试区块（DebugSection）组件测试
 * 验证：未解锁不渲染 / 解锁后渲染 / diag 开关切换 / 一键下载 dump 内容
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider, App as AntdApp } from 'antd'
import { DebugSection } from '@/components/settings/blocks/DebugSection'
import { unlockDebug, lockDebug } from '@/core/lib/debug'
import { enableDiag, disableDiag, dumpDiag } from '@/core/lib/diag'

const messageSpy = vi.hoisted(() => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
}))

// t(key) 直接返回 key（与 NotificationSettings.test.tsx 一致）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

// mock antd App.useApp：拦截 message（其余 antd 真实）
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({ message: messageSpy }),
        },
    }
})

describe('DebugSection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        lockDebug()
        disableDiag()
    })

    afterEach(() => {
        cleanup()
    })

    function renderUi() {
        return render(
            <ConfigProvider>
                <AntdApp>
                    <DebugSection />
                </AntdApp>
            </ConfigProvider>
        )
    }

    it('未解锁时不渲染', () => {
        renderUi()
        expect(screen.queryByText('debug.title')).not.toBeInTheDocument()
    })

    it('解锁后渲染标题与下载按钮', () => {
        unlockDebug()
        renderUi()
        expect(screen.getByText('debug.title')).toBeInTheDocument()
        expect(screen.getByText('debug.download')).toBeInTheDocument()
    })

    it('diag 关闭时点击开关调用 enableDiag 并提示开启', () => {
        unlockDebug()
        renderUi()
        fireEvent.click(screen.getByRole('switch'))
        expect(dumpDiag().enabled).toBe(true)
        expect(messageSpy.success).toHaveBeenCalledWith('debug.diagOn')
    })

    it('diag 开启时点击开关调用 disableDiag 并提示关闭', () => {
        enableDiag()
        unlockDebug()
        renderUi()
        fireEvent.click(screen.getByRole('switch'))
        expect(dumpDiag().enabled).toBe(false)
        expect(messageSpy.success).toHaveBeenCalledWith('debug.diagOff')
    })

    it('diag 未开启时点击下载提示 diagNotEnabled 但仍触发下载', () => {
        unlockDebug()
        renderUi()
        // mock URL 与 a.click（jsdom 无真实 blob/导航）
        const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
        const revokeURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        const clickSpy = vi.fn()
        const origClick = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = clickSpy as unknown as typeof HTMLAnchorElement.prototype.click

        fireEvent.click(screen.getByText('debug.download'))

        expect(messageSpy.warning).toHaveBeenCalledWith('debug.diagNotEnabled')
        expect(clickSpy).toHaveBeenCalled()
        expect(createURLSpy).toHaveBeenCalled()
        expect(revokeURLSpy).toHaveBeenCalled()

        HTMLAnchorElement.prototype.click = origClick
        createURLSpy.mockRestore()
        revokeURLSpy.mockRestore()
    })

    it('diag 开启后点击下载，创建含 dump 内容的 JSON 下载', () => {
        enableDiag()
        unlockDebug()
        renderUi()
        const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
        const revokeURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        const clickSpy = vi.fn()
        const origClick = HTMLAnchorElement.prototype.click
        HTMLAnchorElement.prototype.click = clickSpy as unknown as typeof HTMLAnchorElement.prototype.click

        fireEvent.click(screen.getByText('debug.download'))

        expect(messageSpy.warning).not.toHaveBeenCalled()
        expect(clickSpy).toHaveBeenCalled()
        // blob 内容为 dumpDiag() 的 JSON（含 enabled:true 与工具轨迹结构）
        expect(createURLSpy).toHaveBeenCalled()
        const blob = createURLSpy.mock.calls[0][0] as Blob
        expect(blob.type).toBe('application/json')

        HTMLAnchorElement.prototype.click = origClick
        createURLSpy.mockRestore()
        revokeURLSpy.mockRestore()
    })
})
