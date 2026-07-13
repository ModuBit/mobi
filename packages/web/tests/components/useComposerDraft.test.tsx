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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// jsdom 不实现 requestAnimationFrame，stub 为 setTimeout 便于用 fake/real timer 控制
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
    vi.unstubAllGlobals()
})

const draftStore = vi.hoisted(() => ({
    get: vi.fn<(id: string) => { text: string; attachments: never[] } | null>(() => null),
    save: vi.fn<(id: string, text: string, attachments: unknown[]) => void>(() => {}),
    clear: vi.fn(),
}))

vi.mock('@/core/lib/composerDrafts', () => ({
    getDraft: (id: string) => draftStore.get(id),
    saveDraft: (id: string, text: string, attachments: unknown[]) => draftStore.save(id, text, attachments),
    clearDraft: draftStore.clear,
}))

import { useComposerDraft } from '@/components/composer/useComposerDraft'
import type { FileAttachment } from '@/core/lib/fileAttachments'

/** 等待一个 rAF（stub 为 setTimeout(0)）完成 */
function flushRaf() {
    return new Promise<void>(r => setTimeout(() => r(), 0))
}

interface SetupResult {
    rerender: (props: { sid: string | undefined }) => void
    unmount: () => void
    setText: ReturnType<typeof vi.fn>
    setAttachments: ReturnType<typeof vi.fn>
}

function setup(initialText = '', initialAttachments: FileAttachment[] = [], initialSid: string | undefined = 's1'): SetupResult {
    let text = initialText
    let attachments = initialAttachments
    const setText = vi.fn((v: string) => { text = v })
    const setAttachments = vi.fn((v: FileAttachment[]) => { attachments = v })
    const utils = renderHook(
        ({ sid }) => useComposerDraft(
            sid,
            { get text() { return text }, get attachments() { return attachments } },
            { setText, setAttachments },
        ),
        { initialProps: { sid: initialSid } },
    )
    return { rerender: utils.rerender, unmount: utils.unmount, setText, setAttachments }
}

describe('useComposerDraft', () => {
    beforeEach(() => {
        draftStore.get.mockReset().mockReturnValue(null)
        draftStore.save.mockReset()
    })

    it('挂载时从草稿库恢复 text 与附件', async () => {
        const restored = [{ id: 'a', name: 'f.txt', path: '/p/f.txt', size: 10 }]
        draftStore.get.mockReturnValue({ text: 'hi', attachments: restored })
        const { setText, setAttachments } = setup()
        await act(async () => { await flushRaf() })
        expect(setText).toHaveBeenCalledWith('hi')
        expect(setAttachments).toHaveBeenCalledTimes(1)
        const restored2 = setAttachments.mock.calls[0]![0] as FileAttachment[]
        expect(restored2[0]).toMatchObject({ id: 'a', status: 'complete', path: '/p/f.txt', name: 'f.txt', size: 10 })
    })

    it('卸载时保存当前 text 与附件到旧 sessionId', async () => {
        const { unmount } = setup('hello', [])
        await act(async () => { await flushRaf() }) // 恢复完成 → draftReady=true
        act(() => unmount())
        expect(draftStore.save).toHaveBeenCalledWith('s1', 'hello', [])
    })

    it('sessionId 切换：先保存旧、后恢复新', async () => {
        draftStore.get.mockImplementation((id: string) => id === 's2' ? { text: 's2text', attachments: [] } : null)
        const { rerender, setText } = setup('old', [])
        await act(async () => { await flushRaf() })
        act(() => rerender({ sid: 's2' }))
        expect(draftStore.save).toHaveBeenCalledWith('s1', 'old', [])
        await act(async () => { await flushRaf() })
        expect(setText).toHaveBeenCalledWith('s2text')
    })

    it('draftReady 守卫：恢复完成前卸载不保存，避免空态覆盖真实草稿', () => {
        // 挂载后立即卸载（rAF 未执行 → 未恢复 → 不应保存）
        const { unmount } = setup()
        act(() => unmount())
        expect(draftStore.save).not.toHaveBeenCalled()
    })

    it('sessionId 为 undefined 时不读不写', () => {
        const { unmount } = setup('', [], undefined)
        act(() => unmount())
        expect(draftStore.get).not.toHaveBeenCalled()
        expect(draftStore.save).not.toHaveBeenCalled()
    })
})
