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
import { renderHook, act, cleanup } from '@testing-library/react'

// jsdom 不实现 requestAnimationFrame，stub 为 setTimeout 便于用 fake/real timer 控制
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
    vi.unstubAllGlobals()
})
// vitest 未开 globals：渲染型测试需显式 cleanup，否则上一条用例的 hook 常驻，
// pagehide 监听器跨用例累积（save 计数被幽灵监听抬高）
afterEach(cleanup)

import type { ComposerSegments } from '@/domain/chat/composerSegments'

const draftStore = vi.hoisted(() => ({
    get: vi.fn<(id: string) => ComposerSegments | null>(() => null),
    save: vi.fn<(id: string, segments: unknown) => void>(() => {}),
    clear: vi.fn(),
}))

vi.mock('@/core/lib/composerDrafts', () => ({
    getDraft: (id: string) => draftStore.get(id),
    saveDraft: (id: string, segments: unknown) => draftStore.save(id, segments),
    clearDraft: draftStore.clear,
}))

import { useComposerDraft } from '@/features/composer/useComposerDraft'
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
    setQuotes: ReturnType<typeof vi.fn>
}

/**
 * 空分段工厂：seg() 全空；seg('文本') 仅设正文；
 * seg('文本', { files: [...] }) 叠加覆盖分段
 */
function seg(text = '', overrides: Partial<ComposerSegments> = {}): ComposerSegments {
    return { text, files: [], images: [], quotes: [], ...overrides }
}

function setup(
    initialText = '',
    initialAttachments: FileAttachment[] = [],
    initialSid: string | undefined = 's1',
): SetupResult {
    let text = initialText
    let attachments = initialAttachments
    const setText = vi.fn((v: string) => { text = v })
    const setAttachments = vi.fn((v: FileAttachment[]) => { attachments = v })
    const setQuotes = vi.fn()
    const utils = renderHook(
        ({ sid }) => useComposerDraft(
            sid,
            {
                get text() { return text },
                get attachments() { return attachments },
            },
            { setText, setAttachments, setQuotes },
        ),
        { initialProps: { sid: initialSid } },
    )
    // renderHook 的泛型推断与显式签名冲突，这里收窄为业务可用的rerender 形态
    const rerender = utils.rerender as (props: { sid: string | undefined }) => void
    return { rerender, unmount: utils.unmount, setText, setAttachments, setQuotes }
}

/** 结构化双路专用壳：跨调用共享 editorState getter / applyEditorState mock */
function setupStructured(opts: {
    editorStateJson?: string | null
    initialSid?: string | undefined
} = {}) {
    let text = ''
    const setText = vi.fn((v: string) => { text = v })
    const applyEditorState = vi.fn()
    const getEditorState = vi.fn(() => opts.editorStateJson ?? null)
    const utils = renderHook(
        ({ sid }) => useComposerDraft(
            sid,
            {
                get text() { return text },
                attachments: [],
                quotes: [],
                getEditorState,
            },
            { setText, setAttachments: vi.fn(), setQuotes: vi.fn(), applyEditorState },
        ),
        { initialProps: { sid: opts.initialSid ?? 's1' } },
    )
    const rerender = utils.rerender as (props: { sid: string | undefined }) => void
    return { ...utils, rerender, setText, applyEditorState, getEditorState }
}

describe('useComposerDraft', () => {
    beforeEach(() => {
        draftStore.get.mockReset().mockReturnValue(null)
        draftStore.save.mockReset()
    })

    it('挂载时从草稿库恢复分段：text + 占位附件（files/images 双桶合一）+ 引用', async () => {
        draftStore.get.mockReturnValue(seg('hi', {
            files: [{ id: 'f1', filename: 'r.pdf', path: '/u/r.pdf', mimeType: 'application/pdf', size: 10 }],
            images: [{ id: 'g1', filename: 'p.png', path: '/u/p.png', mimeType: 'image/png', size: 20 }],
            quotes: [{ messageId: 'm1', role: 'agent', excerpt: '引用正文' }],
        }))
        const { setAttachments, setQuotes } = setup()
        await act(async () => { await flushRaf() })
        // 附件还原为占位 File（不再上传），分桶语义由渲染层派生时按扩展名兜底重建
        expect(setAttachments).toHaveBeenCalledTimes(1)
        const restored = setAttachments.mock.calls[0]![0] as FileAttachment[]
        expect(restored.map(a => a.id)).toEqual(['f1', 'g1'])
        expect(restored[0]).toMatchObject({ status: 'complete', path: '/u/r.pdf', name: 'r.pdf', size: 10 })
        expect(restored[0]!.file.name).toBe('r.pdf')
        expect(setQuotes).toHaveBeenCalledWith([{ messageId: 'm1', role: 'agent', excerpt: '引用正文' }])
    })

    it('卸载时按分段保存：附件经 bucketCompletedAttachments 投影；引用桶恒空（chip 在 editorState 里）', async () => {
        const imageAttach: FileAttachment = {
            id: 'g1',
            file: new File([], 'p.png'),
            status: 'complete',
            path: '/u/p.png',
            name: 'p.png',
            size: 99,
        }
        const { unmount } = setup('hello', [imageAttach])
        await act(async () => { await flushRaf() }) // 恢复完成 → draftReady=true
        act(() => unmount())
        expect(draftStore.save).toHaveBeenCalledTimes(1)
        const [, saved] = draftStore.save.mock.calls[0] as [string, ComposerSegments]
        // png 扩展名兜底进 images 桶（占位 File 无 MIME，走扩展名判定）
        expect(saved).toEqual({
            text: 'hello',
            files: [],
            images: [{ id: 'g1', filename: 'p.png', path: '/u/p.png', mimeType: 'image/png', size: 99 }],
            quotes: [],
        })
    })

    it('pagehide 无需卸载即保存（刷新/关闭页面的真实路径）', async () => {
        setup('typed-before-reload')
        await act(async () => { await flushRaf() })
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(draftStore.save).toHaveBeenCalledTimes(1)
        expect(draftStore.save.mock.calls[0]![0]).toBe('s1')
        expect((draftStore.save.mock.calls[0]![1] as ComposerSegments).text).toBe('typed-before-reload')
    })

    it('draftReady 前 pagehide 不保存（不覆盖未恢复的真实草稿）', () => {
        setup('x')
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(draftStore.save).not.toHaveBeenCalled()
    })

    it('卸载后 pagehide 不再触发保存（监听器已随 effect 清理）', async () => {
        const { unmount } = setup('once')
        await act(async () => { await flushRaf() })
        act(() => unmount())
        expect(draftStore.save).toHaveBeenCalledTimes(1)
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(draftStore.save).toHaveBeenCalledTimes(1)
    })

    it('uploading/error/无 path 的附件不进入保存的分段', async () => {
        const list: FileAttachment[] = [
            { id: 'up', file: new File([], 'up.txt'), status: 'uploading' },
            { id: 'err', file: new File([], 'err.txt'), status: 'error', path: '/p/err.txt' },
        ]
        const { unmount } = setup('t', list)
        await act(async () => { await flushRaf() })
        act(() => unmount())
        const [, saved] = draftStore.save.mock.calls[0] as [string, ComposerSegments]
        expect(saved.files).toEqual([])
        expect(saved.images).toEqual([])
    })

    it('sessionId 切换：先保存旧、后恢复新', async () => {
        draftStore.get.mockImplementation((id: string) => id === 's2' ? seg('s2text') : null)
        const { rerender, setText } = setup('old')
        await act(async () => { await flushRaf() })
        act(() => rerender({ sid: 's2' }))
        expect(draftStore.save).toHaveBeenCalledWith('s1', seg('old'))
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

    it('结构化双路：draft 含 editorState → setText 先兜底、applyEditorState 后覆盖', async () => {
        draftStore.get.mockReturnValue({
            ...seg('fallback'),
            editorState: { v: 1 as const, json: '{"type":"doc"}' },
        } as ComposerSegments)
        const { setText, applyEditorState } = setupStructured()
        await act(async () => { await flushRaf() })
        expect(setText).toHaveBeenCalledWith('fallback')
        expect(applyEditorState).toHaveBeenCalledWith('{"type":"doc"}')
        // 语义保证：文本兜底先于结构化覆盖（顺序即终态正确性）
        expect(setText.mock.invocationCallOrder[0]!).toBeLessThan(applyEditorState.mock.invocationCallOrder[0]!)
    })

    it('结构化双路：draft 无 editorState → 只 setText', async () => {
        draftStore.get.mockReturnValue(seg('plain') as ComposerSegments)
        const { setText, applyEditorState } = setupStructured()
        await act(async () => { await flushRaf() })
        expect(setText).toHaveBeenCalledWith('plain')
        expect(applyEditorState).not.toHaveBeenCalled()
    })

    it('结构化双路：卸载保存时 getEditorState 结果进 saveDraft（null 则只存 text 单路）', async () => {
        const withState = setupStructured({ editorStateJson: '{"type":"doc"}' })
        await act(async () => { await flushRaf() })
        act(() => withState.unmount())
        const [, saved] = draftStore.save.mock.calls[0] as [string, ComposerSegments & { editorState?: unknown }]
        expect(saved.editorState).toEqual({ v: 1, json: '{"type":"doc"}' })

        draftStore.save.mockReset()
        const withoutState = setupStructured({ editorStateJson: null })
        await act(async () => { await flushRaf() })
        act(() => withoutState.unmount())
        const [, saved2] = draftStore.save.mock.calls[0] as [string, ComposerSegments & { editorState?: unknown }]
        expect(saved2).not.toHaveProperty('editorState')
    })
})
