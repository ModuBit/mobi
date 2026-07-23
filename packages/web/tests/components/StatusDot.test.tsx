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

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusStateIcon, STATUS_DOT_COLORS, toStatusDotState } from '@/components/tool-card/toolIcons'
import type { AgentStatus } from '@/components/pixel-avatar/types'

/** jsdom 把 inline color 规范化为 rgb()，断言时对齐 */
function rgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgb(${r}, ${g}, ${b})`
}

describe('STATUS_DOT_COLORS', () => {
    it('包含 5 个状态色', () => {
        expect(STATUS_DOT_COLORS.running).toBe('#4dabf7')
        expect(STATUS_DOT_COLORS.awaiting_auth).toBe('#ffa726')
        expect(STATUS_DOT_COLORS.idle).toBe('#66bb6a')
        expect(STATUS_DOT_COLORS.inactive).toBe('#d9d9d9')
        expect(STATUS_DOT_COLORS.error).toBe('#ef5350')
    })
})

describe('toStatusDotState', () => {
    it('映射 session 侧 AgentStatus', () => {
        const cases: [AgentStatus, string][] = [
            ['outputting', 'running'],
            ['awaiting_auth', 'awaiting_auth'],
            ['idle', 'idle'],
            ['inactive', 'inactive'],
        ]
        for (const [input, expected] of cases) {
            expect(toStatusDotState(input)).toBe(expected)
        }
    })

    it('映射工具侧 ToolCallState', () => {
        expect(toStatusDotState('running')).toBe('running')
        expect(toStatusDotState('pending')).toBe('pending')
        expect(toStatusDotState('completed')).toBe('completed')
        expect(toStatusDotState('error')).toBe('error')
    })
})

describe('StatusStateIcon', () => {
    it('running 渲染蓝色 + 带呼吸动画', () => {
        const { container } = render(<StatusStateIcon state="running" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#4dabf7'))
        expect(dot.style.animation).toContain('status-dot-breathe')
    })

    it('awaiting_auth 渲染橙色 + 带颤动动画', () => {
        const { container } = render(<StatusStateIcon state="awaiting_auth" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#ffa726'))
        expect(dot.style.animation).toContain('status-dot-shake')
    })

    it('idle 渲染绿色 + 带舒缓呼吸', () => {
        const { container } = render(<StatusStateIcon state="idle" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#66bb6a'))
        expect(dot.style.animation).toContain('status-dot-breathe-slow')
    })

    it('inactive 灰色 + 无动画', () => {
        const { container } = render(<StatusStateIcon state="inactive" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#d9d9d9'))
        expect(dot.style.animation).toBe('')
    })

    it('error 红色 + 无动画', () => {
        const { container } = render(<StatusStateIcon state="error" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#ef5350'))
        expect(dot.style.animation).toBe('')
    })

    it('completed 绿色 + 静态（工具执行成功）', () => {
        const { container } = render(<StatusStateIcon state="completed" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#66bb6a'))
        expect(dot.style.animation).toBe('')
    })

    it('接受 AgentStatus（outputting 等同 running）', () => {
        const { container } = render(<StatusStateIcon state="outputting" />)
        const dot = container.firstChild as HTMLElement
        expect(dot.style.background).toBe(rgb('#4dabf7'))
    })
})
