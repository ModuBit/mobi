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

describe('UpdatePrompt（移动端顶栏悬浮钮）', () => {
    afterEach(cleanup)

    it('onUpdate=null → 不渲染', () => {
        const { container } = render(<UpdatePrompt onUpdate={null} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('onUpdate 非 null → 渲染悬浮钮（aria-label + 刷新文案）', () => {
        render(<UpdatePrompt onUpdate={() => {}} />)
        expect(screen.getByRole('button', { name: 'notification.pwa.updateAvailable' })).toBeInTheDocument()
        expect(screen.getByText('notification.pwa.updateAction')).toBeInTheDocument()
    })

    it('点击 → 调用 onUpdate', () => {
        const onUpdate = vi.fn()
        render(<UpdatePrompt onUpdate={onUpdate} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onUpdate).toHaveBeenCalledTimes(1)
    })
})

describe('UpdateIconButton（PC 侧栏/WCO 图标钮）', () => {
    afterEach(cleanup)

    it('渲染带 aria-label 的图标钮，点击调用 onUpdate', () => {
        const onUpdate = vi.fn()
        render(<UpdateIconButton onUpdate={onUpdate} />)
        const button = screen.getByRole('button', { name: 'notification.pwa.updateAvailable' })
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
