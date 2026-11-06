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

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'

import { ArchivedListSkeleton } from '@/features/layout/ArchivedListSkeleton'

afterEach(cleanup)

describe('ArchivedListSkeleton', () => {
    it('默认渲染 6 行占位并标记 aria-busy', () => {
        const { container } = render(
            <ConfigProvider>
                <ArchivedListSkeleton />
            </ConfigProvider>,
        )

        expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
        expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(6)
    })

    it('行数可配（加载态行数跟随调用方）', () => {
        const { container } = render(
            <ConfigProvider>
                <ArchivedListSkeleton rows={3} />
            </ConfigProvider>,
        )

        expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3)
    })
})
