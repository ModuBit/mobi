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
import type { BackgroundTask } from '@/domain/chat/types'

const { BackgroundTaskCard } = await import('@/components/composer/BackgroundTaskCard')

afterEach(cleanup)

function makeTask(overrides: Partial<BackgroundTask>): BackgroundTask {
    return {
        taskId: 'bgt-1',
        toolName: 'Bash',
        status: 'running',
        description: 'run tests',
        summary: 'running…',
        metrics: { durationMs: 0, tokens: 0 },
        ...overrides,
    } as BackgroundTask
}

describe('BackgroundTaskCard 非Agent任务图标', () => {
    it('running 态渲染通用 LoadingOutlined 转圈', () => {
        const { container } = render(<BackgroundTaskCard task={makeTask({})} onClick={() => {}} />)
        expect(container.querySelector('.anticon-loading')).not.toBeNull()
    })

    it('终态渲染 Terminal 图标（completed），无 loading', () => {
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ status: 'completed' })} onClick={() => {}} />,
        )
        expect(container.querySelector('.anticon-loading')).toBeNull()
        // lucide Terminal svg（class 含 lucide）
        expect(container.querySelector('svg.lucide-terminal')).not.toBeNull()
    })
})
