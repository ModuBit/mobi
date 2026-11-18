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
 * 历史 local 会话的只读遮罩（tui-fork 票 04）：
 * 存在只读说明；不提供任何操作入口（模式切换已随 local 退场）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LocalModeCover } from '@/features/composer/LocalModeCover'

afterEach(cleanup)

describe('LocalModeCover', () => {
    it('展示只读说明', () => {
        render(<LocalModeCover message="该会话在本地终端运行，Web 端仅可查看" />)
        expect(screen.getByText('该会话在本地终端运行，Web 端仅可查看')).toBeInTheDocument()
    })

    it('不提供任何操作入口', () => {
        render(<LocalModeCover message="只读" />)
        expect(screen.queryByRole('button')).toBeNull()
        expect(screen.queryByRole('link')).toBeNull()
    })
})
