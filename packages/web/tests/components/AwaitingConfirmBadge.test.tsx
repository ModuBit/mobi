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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { AwaitingConfirmBadge } from '@/components/ui/AwaitingConfirmBadge'

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => (key === 'common.awaitingConfirm' ? '等待确认' : key),
        }),
    }
})

afterEach(cleanup)

describe('AwaitingConfirmBadge', () => {
    it('渲染状态点与统一文案「等待确认」', () => {
        render(
            <ConfigProvider>
                <AwaitingConfirmBadge />
            </ConfigProvider>,
        )
        expect(screen.getByTestId('awaiting-confirm-badge')).toBeInTheDocument()
        expect(screen.getByText('等待确认')).toBeInTheDocument()
    })
})
