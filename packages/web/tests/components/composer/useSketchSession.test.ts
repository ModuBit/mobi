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
 * useSketchSession 测试：会话状态机的核心语义经 hook interface 直接验证
 * （此前这些语义只能全量渲染 ChatComposer 才能触达）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useSketchSession, type UseSketchSessionDeps } from '@/components/composer/useSketchSession'
import type { FileAttachment } from '@/core/lib/fileAttachments'

function makeDeps(overrides: Partial<UseSketchSessionDeps> = {}) {
    return {
        addSketchFile: vi.fn(),
        removeAttachment: vi.fn(),
        notifyLoadFailed: vi.fn(),
        resolveContext: { sessionId: 's1' },
        ...overrides,
    }
}

/** 恢复态占位附件：file 空壳 + 服务端 path（重编辑需回源） */
function makePlaceholder(id = 'a1'): FileAttachment {
    return {
        id, name: 'sketch-1.excalidraw.png', file: new File([], 'sketch-1.excalidraw.png'),
        status: 'complete', size: 100, path: '/uploads/2026-09/sketch-1-x.excalidraw.png',
    } as unknown as FileAttachment
}

function mockFetchBlob(ok = true) {
    return vi.fn().mockResolvedValue({ ok, blob: () => Promise.resolve(new Blob(['png'])) })
}

describe('useSketchSession', () => {
    afterEach(cleanup)

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchBlob())
    })

    it('everOpened 门控：open 前为 false，openNew 后恒 true，cancel 不复位', () => {
        const { result } = renderHook(() => useSketchSession(makeDeps()))
        expect(result.current.everOpened).toBe(false)
        act(() => result.current.openNew())
        expect(result.current.everOpened).toBe(true)
        expect(result.current.session).toMatchObject({ initialSketch: null, editingId: null })
        act(() => result.current.cancel())
        expect(result.current.session).toBeNull()
        expect(result.current.everOpened).toBe(true)
    })

    it('完成语义：png=null + 重编辑 → 删除旧附件并关闭；新建 → 仅关闭', () => {
        const deps = makeDeps()
        const { result } = renderHook(() => useSketchSession(deps))
        act(() => result.current.openForAttachment(makePlaceholder()))
        act(() => result.current.complete(null, 'x.excalidraw.png', { format: 'excalidraw' }))
        expect(deps.removeAttachment).toHaveBeenCalledWith('a1')
        expect(result.current.session).toBeNull()

        act(() => result.current.openNew())
        act(() => result.current.complete(null, 'x.excalidraw.png', { format: 'excalidraw' }))
        expect(deps.removeAttachment).toHaveBeenCalledTimes(1) // 新建不删附件
    })

    it('完成语义：png 非空 + 重编辑（有 path）→ addSketchFile 带 replaceId + replacePath 同 path 替换', () => {
        const deps = makeDeps()
        const { result } = renderHook(() => useSketchSession(deps))
        act(() => result.current.openForAttachment(makePlaceholder('a2')))
        act(() => {
            result.current.complete(new Blob(['png']), 'sketch.excalidraw.png', { format: 'excalidraw' })
        })
        expect(deps.addSketchFile).toHaveBeenCalledWith(
            expect.any(File), { format: 'excalidraw' }, 'a2', '/uploads/2026-09/sketch-1-x.excalidraw.png',
        )
    })

    it('完成语义：png 非空 + 重编辑（无 path）→ 仅 replaceId，退化为换新附件', () => {
        const deps = makeDeps()
        const { result } = renderHook(() => useSketchSession(deps))
        act(() => result.current.openForAttachment({ ...makePlaceholder('a4'), path: undefined }))
        act(() => {
            result.current.complete(new Blob(['png']), 'sketch.excalidraw.png', { format: 'excalidraw' })
        })
        expect(deps.addSketchFile).toHaveBeenCalledWith(
            expect.any(File), { format: 'excalidraw' }, 'a4', undefined,
        )
    })

    it('完成语义：png=unchanged（重编辑未动笔）→ 仅关闭，原附件原样保留', () => {
        const deps = makeDeps()
        const { result } = renderHook(() => useSketchSession(deps))
        act(() => result.current.openForAttachment(makePlaceholder('a3')))
        act(() => {
            result.current.complete('unchanged', 'sketch.excalidraw.png', { format: 'excalidraw' })
        })
        expect(deps.addSketchFile).not.toHaveBeenCalled()
        expect(deps.removeAttachment).not.toHaveBeenCalled()
        expect(result.current.session).toBeNull()
    })

    it('附件回源：先开画板再异步回填', async () => {
        const { result } = renderHook(() => useSketchSession(makeDeps()))
        act(() => result.current.openForAttachment(makePlaceholder()))
        // 回填前 session 已打开（本地字节为空 → initialSketch null）
        expect(result.current.session).toMatchObject({ initialSketch: null, editingId: 'a1' })
        await act(async () => { await Promise.resolve() }) // flush fetch promise
        expect(result.current.session?.initialSketch).toBeInstanceOf(Blob)
    })

    it('editingId 守卫：会话切换后迟到的回填被丢弃', async () => {
        let resolveFetch!: (v: { ok: boolean; blob: () => Promise<Blob> }) => void
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(r => { resolveFetch = r })))
        const { result } = renderHook(() => useSketchSession(makeDeps()))
        act(() => result.current.openForAttachment(makePlaceholder('a1')))
        act(() => result.current.openNew()) // 用户切到新建会话
        await act(async () => {
            resolveFetch({ ok: true, blob: () => Promise.resolve(new Blob(['png'])) })
            await Promise.resolve()
        })
        // 迟到回填不污染当前（新建）会话
        expect(result.current.session).toMatchObject({ initialSketch: null, editingId: null })
    })

    it('token 守卫：同形会话（气泡重编辑 → 新建）的迟到回填也被丢弃', async () => {
        // editingId 守卫覆盖不了这条路径：气泡重编辑与新建都是 {initialSketch: null,
        // editingId: null}，守卫必须依赖每次 open 递增的 token
        let resolveFetch!: (v: { ok: boolean; blob: () => Promise<Blob> }) => void
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(r => { resolveFetch = r })))
        const { result } = renderHook(() => useSketchSession(makeDeps()))
        act(() => result.current.openFromBubble('/uploads/a.png')) // 慢 fetch 在途
        act(() => result.current.openNew()) // 用户改点「新建」空白画布
        await act(async () => {
            resolveFetch({ ok: true, blob: () => Promise.resolve(new Blob(['png'])) })
            await Promise.resolve()
        })
        // A 草图的迟到回填不得写入新建的空白画布
        expect(result.current.session).toMatchObject({ initialSketch: null, editingId: null })
    })

    it('回源失败：notifyLoadFailed，会话保持打开（留空画布可继续画）', async () => {
        vi.stubGlobal('fetch', mockFetchBlob(false))
        const deps = makeDeps()
        const { result } = renderHook(() => useSketchSession(deps))
        act(() => result.current.openForAttachment(makePlaceholder()))
        await act(async () => { await Promise.resolve() })
        expect(deps.notifyLoadFailed).toHaveBeenCalled()
        expect(result.current.session).not.toBeNull()
    })
})
