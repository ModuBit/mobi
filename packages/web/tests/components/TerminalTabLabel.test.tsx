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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
// 导入真实 i18n 实例并切换到 zh，让 useTranslation 返回实际翻译文本（含 {{n}} 插值）
import i18n from '@/core/config/i18n'
import { TerminalTabLabel } from '@/components/session/TerminalTabLabel'
import type { InspectorTabEntry } from '@/core/data/stores/workspaceStore'

beforeAll(async () => {
    await i18n.changeLanguage('zh')
})
// vitest 未开 globals:true，@testing-library/react 的自动 cleanup 不生效，需手动清理
afterEach(cleanup)

const baseTab = (over: Partial<InspectorTabEntry> = {}): InspectorTabEntry => ({
    id: 't1', mode: 'terminal', terminalId: 'pty1', terminalSeq: 1, ...over,
})

describe('TerminalTabLabel', () => {
    it('无 title 显示默认"终端 1"', () => {
        render(<TerminalTabLabel tab={baseTab()} onRename={vi.fn()} />)
        expect(screen.getByText('终端 1')).toBeInTheDocument()
    })

    it('有 title 显示自定义名', () => {
        render(<TerminalTabLabel tab={baseTab({ title: 'build' })} onRename={vi.fn()} />)
        expect(screen.getByText('build')).toBeInTheDocument()
    })

    it('双击进入编辑，回车确认调用 onRename', () => {
        const onRename = vi.fn()
        render(<TerminalTabLabel tab={baseTab()} onRename={onRename} />)
        fireEvent.doubleClick(screen.getByText('终端 1'))
        const input = screen.getByDisplayValue('终端 1')
        fireEvent.change(input, { target: { value: 'logs' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onRename).toHaveBeenCalledWith('logs')
    })

    it('Esc 取消不调用 onRename', () => {
        const onRename = vi.fn()
        render(<TerminalTabLabel tab={baseTab()} onRename={onRename} />)
        fireEvent.doubleClick(screen.getByText('终端 1'))
        const input = screen.getByDisplayValue('终端 1')
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(onRename).not.toHaveBeenCalled()
        expect(screen.getByText('终端 1')).toBeInTheDocument()
    })

    it('失焦（blur）触发 commit，调用 onRename', () => {
        const onRename = vi.fn()
        render(<TerminalTabLabel tab={baseTab()} onRename={onRename} />)
        fireEvent.doubleClick(screen.getByText('终端 1'))
        const input = screen.getByDisplayValue('终端 1')
        fireEvent.change(input, { target: { value: 'logs' } })
        fireEvent.blur(input)
        expect(onRename).toHaveBeenCalledWith('logs')
    })

    it('Esc 取消后再触发 blur 不调用 onRename（锁 activeRef 守卫）', () => {
        const onRename = vi.fn()
        render(<TerminalTabLabel tab={baseTab()} onRename={onRename} />)
        fireEvent.doubleClick(screen.getByText('终端 1'))
        const input = screen.getByDisplayValue('终端 1')
        fireEvent.change(input, { target: { value: 'logs' } })
        fireEvent.keyDown(input, { key: 'Escape' })
        // Esc 已取消，后续 blur 不应误提交
        fireEvent.blur(input)
        expect(onRename).not.toHaveBeenCalled()
    })

    it('默认名 tab 未改动直接 blur，不调用 onRename（保持 title=undefined 走 i18n 回退）', () => {
        const onRename = vi.fn()
        render(<TerminalTabLabel tab={baseTab()} onRename={onRename} />)
        fireEvent.doubleClick(screen.getByText('终端 1'))
        const input = screen.getByDisplayValue('终端 1')
        // 不改动 draft，直接 blur
        fireEvent.blur(input)
        expect(onRename).not.toHaveBeenCalled()
    })
})
