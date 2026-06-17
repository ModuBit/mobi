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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// t(key) 直接返回 key（与项目其他组件测试一致）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { UpdatePrompt } from '@/components/layout/UpdatePrompt'

describe('UpdatePrompt', () => {
    afterEach(() => cleanup())

    it('onUpdate=null → 不渲染 banner', () => {
        render(<UpdatePrompt onUpdate={null} />)
        expect(screen.queryByText('notification.pwa.updateAvailable')).not.toBeInTheDocument()
    })

    it('onUpdate 非 null → 渲染 banner + 刷新按钮', () => {
        render(<UpdatePrompt onUpdate={() => {}} />)
        expect(screen.getByText('notification.pwa.updateAvailable')).toBeInTheDocument()
        expect(screen.getByText('notification.pwa.updateAction')).toBeInTheDocument()
    })

    it('点击刷新按钮 → 调用 onUpdate', () => {
        const onUpdate = vi.fn()
        render(<UpdatePrompt onUpdate={onUpdate} />)
        fireEvent.click(screen.getByText('notification.pwa.updateAction'))
        expect(onUpdate).toHaveBeenCalledTimes(1)
    })
})
