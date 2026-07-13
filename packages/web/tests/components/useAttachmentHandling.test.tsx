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

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAttachmentHandling } from '@/components/composer/useAttachmentHandling'
import type { DirectoryCapabilities } from '@/core/data/hooks/queries/useDirectoryCapabilities'

vi.mock('antd', () => ({ message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

// 绕过真实文件校验，直接让 processFiles 进入上传分支
vi.mock('@/core/lib/fileAttachments', () => ({
    validateFile: () => undefined,
    createFileAttachment: (file: File) => ({
        id: 'test-id',
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'uploading',
    }),
    getAcceptExtensions: () => '*',
}))

function makeCapabilities(uploadFile: ReturnType<typeof vi.fn>): DirectoryCapabilities {
    return {
        uploadFile,
        deleteUpload: vi.fn().mockResolvedValue({ data: { success: true } }),
        searchFiles: vi.fn(),
        listDirectory: vi.fn(),
    } as unknown as DirectoryCapabilities
}

describe('useAttachmentHandling', () => {
    it('组件卸载时中止进行中的上传，避免孤立文件 (#6)', async () => {
        let capturedSignal: AbortSignal | undefined
        const uploadFile = vi.fn((_file: File, opts?: { signal?: AbortSignal }) => {
            capturedSignal = opts?.signal
            // 永不 resolve，模拟上传进行中
            return new Promise(() => {})
        })
        const capabilities = makeCapabilities(uploadFile)
        const { result, unmount } = renderHook(() => useAttachmentHandling('s1', capabilities))

        await act(async () => {
            result.current.handleDrop({
                preventDefault: () => {},
                dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
            } as any)
        })

        expect(uploadFile).toHaveBeenCalledTimes(1)
        expect(capturedSignal).toBeDefined()
        expect(capturedSignal!.aborted).toBe(false)

        // 卸载组件，应触发 cleanup 中止上传
        unmount()
        expect(capturedSignal!.aborted).toBe(true)
    })

    it('controlsDisabled 置 true 时重置拖拽覆盖层 (#3)', () => {
        const capabilities = makeCapabilities(vi.fn())
        const { result, rerender } = renderHook(
            ({ cd }: { cd: boolean }) => useAttachmentHandling('s1', capabilities, cd),
            { initialProps: { cd: false } },
        )

        // 拖拽进入 → 覆盖层显示
        act(() => {
            result.current.handleDragEnter({ preventDefault: () => {} } as any)
        })
        expect(result.current.isDragOver).toBe(true)

        // 会话失活/归档 → 控件禁用 → 覆盖层应被重置
        rerender({ cd: true })
        expect(result.current.isDragOver).toBe(false)
    })

    it('上传进度经 onProgress 回调更新到 attachment.progress', async () => {
        let capturedOnProgress: ((p: number) => void) | undefined
        const uploadFile = vi.fn((_file: File, opts?: { signal?: AbortSignal; onProgress?: (p: number) => void }) => {
            capturedOnProgress = opts?.onProgress
            // 永不 resolve，模拟上传进行中
            return new Promise<{ data: { success: boolean; path: string } }>(() => {})
        })
        const capabilities = makeCapabilities(uploadFile)
        const { result } = renderHook(() => useAttachmentHandling('s1', capabilities))

        await act(async () => {
            result.current.handleDrop({
                preventDefault: () => {},
                dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
            } as any)
        })

        expect(capturedOnProgress).toBeDefined()

        // 触发进度回调 → attachment.progress 应实时更新
        await act(async () => {
            capturedOnProgress!(50)
        })
        expect(result.current.attachments[0].progress).toBe(50)
    })

    it('sessionId 变化时中止进行中的上传并清空附件（避免孤儿文件/跨 session 污染）', async () => {
        let capturedSignal: AbortSignal | undefined
        const uploadFile = vi.fn((_file: File, opts?: { signal?: AbortSignal }) => {
            capturedSignal = opts?.signal
            // 永不 resolve，模拟上传进行中
            return new Promise(() => {})
        })
        const capabilities = makeCapabilities(uploadFile)
        const { result, rerender, unmount } = renderHook(
            ({ sid }: { sid: string | undefined }) => useAttachmentHandling(sid, capabilities),
            { initialProps: { sid: 's1' as string | undefined } },
        )

        await act(async () => {
            result.current.handleDrop({
                preventDefault: () => {},
                dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
            } as any)
        })
        expect(result.current.attachments.length).toBe(1)
        expect(capturedSignal?.aborted).toBe(false)

        // 同实例切换到 s2（TanStack Router 复用组件）：应中止 s1 的上传 + 清空附件
        act(() => rerender({ sid: 's2' }))
        expect(capturedSignal?.aborted).toBe(true)
        expect(result.current.attachments.length).toBe(0)

        unmount()
    })
})
