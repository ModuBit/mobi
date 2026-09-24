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

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { BackgroundTask } from '@/domain/chat/types'

const { BackgroundTaskCard } = await import('@/components/composer/BackgroundTaskCard')

// jsdom 的 matchMedia stub恒 matches:false → useIsMobile 恒 true（移动端分支）。
// 桌面端两击确认按钮（TwoStepConfirmButton）只在桌面分支渲染，这里固定 mock 桌面端
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => false,
}))

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

describe('BackgroundTaskCard toolName=unknown（诚实降级，review fix2 A2）', () => {
    it('unknown 卡片不渲染 Bash Terminal 图标，也不渲染 running 转圈', () => {
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ toolName: 'unknown', status: 'running' })} onClick={() => {}} />,
        )
        // 不冒充 Bash 终端图标
        expect(container.querySelector('svg.lucide-terminal')).toBeNull()
        // unknown + running 也不渲染转圈（running 转圈是 Bash/Monitor 的通用 loading 位）
        expect(container.querySelector('.anticon-loading')).toBeNull()
        // 渲染中性图形（lucide CircleDashed）
        expect(container.querySelector('svg.lucide-circle-dashed')).not.toBeNull()
    })

    it('paused 状态不挂停止按钮、不转圈（isRunning 判定保持 status===running）', () => {
        const onStop = vi.fn()
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ toolName: 'unknown', status: 'paused' })} onClick={() => {}} onStop={onStop} />,
        )
        expect(container.querySelector('.anticon-loading')).toBeNull()
        // showStop = onStop && status==='running'：paused 不渲染停止按钮
        expect(container.querySelector('svg.lucide-circle-stop')).toBeNull()
    })
})

describe('BackgroundTaskCard 点击守卫内聚（review fix2 C2）', () => {
    it('toolUseId=null 时点击不回调，cursor 非 pointer（不设任何禁用 prop 也要成立）', () => {
        const onClick = vi.fn()
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ toolUseId: null })} onClick={onClick} />,
        )
        const card = container.querySelector('[data-testid="bg-task-card-bgt-1"]') as HTMLElement
        expect(card).toBeTruthy()
        fireEvent.click(card)
        expect(onClick).not.toHaveBeenCalled()
        expect(card.style.cursor).not.toBe('pointer')
    })

    it('toolUseId 非空时点击回调，cursor 为 pointer', () => {
        const onClick = vi.fn()
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ toolUseId: 'tu-1' })} onClick={onClick} />,
        )
        const card = container.querySelector('[data-testid="bg-task-card-bgt-1"]') as HTMLElement
        fireEvent.click(card)
        expect(onClick).toHaveBeenCalled()
        expect(card.style.cursor).toBe('pointer')
    })

    it('点击停止按钮不触发卡片 onClick（桌面端两击确认分支，冒泡拦截）', () => {
        const onClick = vi.fn()
        const onStop = vi.fn()
        const { container } = render(
            <BackgroundTaskCard task={makeTask({ toolUseId: 'tu-1' })} onClick={onClick} onStop={onStop} />,
        )
        const stopButton = container.querySelector('svg.lucide-circle-stop')?.closest('div') as HTMLElement
        expect(stopButton).toBeTruthy()
        fireEvent.click(stopButton)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('两击确认停止：展开面板点 ✓ 后调用 onStop', () => {
        const onStop = vi.fn()
        const { container, getByRole } = render(
            <BackgroundTaskCard task={makeTask({ toolUseId: 'tu-1' })} onClick={() => {}} onStop={onStop} />,
        )
        const trigger = container.querySelector('button[aria-label]') as HTMLElement
        fireEvent.click(trigger)
        const confirmButton = container.querySelector('.lucide-check')?.closest('button') as HTMLElement
        expect(confirmButton).toBeTruthy()
        fireEvent.click(confirmButton)
        expect(onStop).toHaveBeenCalledTimes(1)
    })
})
