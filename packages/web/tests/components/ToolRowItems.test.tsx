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
import { ConfigProvider } from 'antd'
import { ToolRowItems } from '@/components/ui/ToolRowItems'
import type { ToolRow } from '@/core/lib/toolRow'

/**
 * 回归守卫：工具行新形态（动词 + chip）的运行态 shimmer。
 *
 * 背景：运行态扫光最初只挂在 CrossfadeText 回退路径（ToolCallBlock 非行形态），
 * Bash/Edit 等走 ToolRowItems 行形态的工具改版时没接 shimmer——运行中的行
 * 没有任何 blink 反馈（2026-09-20 用户实测截图）。
 *
 * 约定：shimmer=true 时动词与摘要合并在**同一个** .shimmer-text 里（gradient 跨
 * 组合宽度连成一道波——分属两个元素时流式期相位错开、各眨各的，2026-09-25 验收）；
 * chip / stats / rowMeta 保持静态（徽章不扫光）。
 */

const row: ToolRow = {
    verb: 'Bash',
    summary: 'bun run test:web',
    chip: { text: 'packages/web' },
    rowMeta: null,
    stats: null,
}

const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider>{children}</ConfigProvider>

describe('ToolRowItems 运行态 shimmer', () => {
    afterEach(cleanup)

    it('shimmer=true：动词与摘要同属一个 shimmer-text（一道波），chip 不挂', () => {
        const { container } = render(<ToolRowItems row={row} shimmer />, { wrapper })
        const shimmered = container.querySelectorAll('.shimmer-text')
        // 动词 + 摘要合并单元素（扫光跨两者连成一道）；chip（FileChip）不在扫光范围
        expect(shimmered.length).toBe(1)
        expect(shimmered[0].textContent).toBe('Bashbun run test:web')
        expect(container.textContent).toContain('packages/web')
    })

    it('shimmer 缺省 false：不挂任何 shimmer-text（完成态不扫光）', () => {
        const { container } = render(<ToolRowItems row={row} />, { wrapper })
        expect(container.querySelector('.shimmer-text')).toBeNull()
    })
})
