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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// t(key) 直接返回 key（与项目其他组件测试一致）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { UpdatePrompt, UpdateIconButton } from '@/components/layout/UpdatePrompt'
import { useUpdateAvailable, setUpdateReload } from '@/core/pwa/useUpdateAvailable'

describe('UpdatePrompt（移动端顶栏悬浮胶囊）', () => {
    afterEach(cleanup)

    it('onUpdate=null → 不渲染', () => {
        const { container } = render(<UpdatePrompt onUpdate={null} onClose={() => {}} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('渲染刷新主操作与关闭按钮', () => {
        render(<UpdatePrompt onUpdate={() => {}} onClose={() => {}} />)
        expect(screen.getByRole('button', { name: 'notification.pwa.updateAvailable' })).toBeInTheDocument()
        expect(screen.getByText('notification.pwa.updateAction')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'common.close' })).toBeInTheDocument()
    })

    it('点击主操作 → 调用 onUpdate；点击关闭 → 调用 onClose', () => {
        const onUpdate = vi.fn()
        const onClose = vi.fn()
        render(<UpdatePrompt onUpdate={onUpdate} onClose={onClose} />)
        fireEvent.click(screen.getByRole('button', { name: 'notification.pwa.updateAvailable' }))
        expect(onUpdate).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})

describe('UpdateIconButton（PC 侧栏/WCO 图标+文案按钮）', () => {
    afterEach(cleanup)

    it('渲染带文案与 aria-label 的按钮，点击调用 onUpdate', () => {
        const onUpdate = vi.fn()
        render(<UpdateIconButton onUpdate={onUpdate} />)
        const button = screen.getByRole('button', { name: 'notification.pwa.updateAvailable' })
        expect(button).toHaveTextContent('notification.pwa.updateAvailable')
        fireEvent.click(button)
        expect(onUpdate).toHaveBeenCalledTimes(1)
    })
})

describe('useUpdateAvailable 广播', () => {
    afterEach(() => {
        cleanup()
        setUpdateReload(null)
    })

    it('setUpdateReload 后订阅方收到 reload', async () => {
        function Consumer() {
            const reload = useUpdateAvailable()
            return <button onClick={() => reload?.()} disabled={!reload}>go</button>
        }
        render(<Consumer />)
        expect(screen.getByRole('button')).toBeDisabled()

        const reload = vi.fn()
        await act(async () => setUpdateReload(reload))
        expect(screen.getByRole('button')).toBeEnabled()

        fireEvent.click(screen.getByRole('button'))
        expect(reload).toHaveBeenCalledTimes(1)
    })
})
