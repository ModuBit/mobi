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
 * UI 来源标记规格（generative-ui 票 06 安全缓解）：仅 UI 回灌两值（openui/app）标注，
 * 手打（缺省）/CLI 回显/任意其他值不标——恶意 HTML 即便伪造不出 sentFrom（daemon 窄
 * 字面量），这里也只认已知两值，未知值静默不标。
 */

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { SentFromTag } from '@/components/chat/blocks/SentFromTag'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

describe('SentFromTag（渲染）', () => {
    it('openui / app 渲染来源 chip，手打不渲染', () => {
        const { rerender } = render(<SentFromTag sentFrom="app" />)
        expect(screen.getByTestId('user-msg-origin')).toHaveTextContent('chat.origin.app')
        rerender(<SentFromTag sentFrom="openui" />)
        expect(screen.getByTestId('user-msg-origin')).toHaveTextContent('chat.origin.openui')
        rerender(<SentFromTag sentFrom={undefined} />)
        expect(screen.queryByTestId('user-msg-origin')).not.toBeInTheDocument()
    })
})
