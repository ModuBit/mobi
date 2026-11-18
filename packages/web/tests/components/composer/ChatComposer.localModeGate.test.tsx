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
 * ChatComposer local 只读态附件闸（回归测试）。
 *
 * 背景：local 只读态曾有两道不一致的禁用闸——遮罩/发送钮走 chromeDisabled（含
 * showLocalModeCover），而拖拽/发送走 controlsDisabled（不含）。后果：遮罩盖住输入区
 * 但 drop 事件冒泡到 wrapper 仍命中 handler → processFiles 真实调 capabilities.uploadFile
 * 落服务端（附件卡可增删、发不出去、卸载后服务端留孤儿文件）。
 *
 * 本文件锁定修复后的契约：local 只读态下附件通道（拖放/粘贴）与发送同闸关闭，
 * 正常模式不受影响（防误伤）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { useEffect, useRef } from 'react'
import { render, screen, fireEvent, createEvent, waitFor, cleanup } from '@testing-library/react'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom/vitest'
import type { ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { ChatComposer } from '@/pages/session/ChatComposer'
import { useComposerScaffold } from '@/features/composer/useComposerScaffold'

// mock i18n：key 直通桩（断言 key 而非文案；占位符随机取数的 returnObjects 分支
// 对字符串取 length 同样可用，不影响渲染）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

// 能力探测 mock：uploadFile 间谍是本测试的核心断言点（local 只读态绝不可被调用）
const { uploadFileSpy, deleteUploadSpy, capabilitiesStub } = vi.hoisted(() => {
    const uploadFileSpy = vi.fn(async () => ({ data: { success: true, path: '/uploads/a.txt' } }))
    const deleteUploadSpy = vi.fn(async () => ({ data: { success: true } }))
    const capabilitiesStub = {
        metadata: null,
        metadataLoading: false,
        commands: [],
        searchFiles: vi.fn(async () => ({ data: { success: false } })),
        listDirectory: vi.fn(async () => ({ data: { success: false } })),
        uploadFile: uploadFileSpy,
        deleteUpload: deleteUploadSpy,
        replaceUpload: vi.fn(async () => ({ data: { success: true, path: '/uploads/a.txt' } })),
    }
    return { uploadFileSpy, deleteUploadSpy, capabilitiesStub }
})

vi.mock('@/core/data/hooks/queries/useDirectoryCapabilities', () => ({
    useDirectoryCapabilities: () => capabilitiesStub,
}))

vi.mock('@/core/data/hooks/queries/useSDKMetadata', () => ({
    useSDKMetadata: () => ({ data: undefined }),
}))

vi.mock('@/features/composer/useDirectoryCommands', () => ({
    useDirectoryCommands: () => ({ data: undefined, isLoading: false }),
}))

// ChatComposer 的子树还会引 api client（extractApiError 等），保留真实导出、
// 仅替换 useMobiApi 为稳定引用（mock 对象跨渲染同一身份，避免 effect 循环）
vi.mock('@/core/data/api/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/api/client')>()
    return {
        ...actual,
        useMobiApi: () => ({
            sessions: {
                clearRuntimeStateFields: vi.fn(async () => ({})),
                searchFiles: vi.fn(async () => ({ data: { success: false } })),
                listDirectory: vi.fn(async () => ({ data: { success: false } })),
            },
        }),
    }
})

vi.mock('@/core/data/hooks/mutations/useSwitchOutputStyle', () => ({
    useSwitchOutputStyle: () => ({ mutate: vi.fn(), isPending: false }),
}))

// vitest 未开 globals，渲染型测试必须显式 cleanup，否则 DOM 跨用例累积
afterEach(() => {
    cleanup()
    uploadFileSpy.mockClear()
    deleteUploadSpy.mockClear()
})

function renderComposer(props: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <App>
                <ChatComposer sessionId="s1" onSend={vi.fn()} {...props} />
            </App>
        </QueryClientProvider>,
    )
}

function makeFile(name = 'a.txt'): File {
    return new File(['hello'], name, { type: 'text/plain' })
}

/** 在目标元素上派发带 dataTransfer 的 drop 事件（jsdom 构造器不支持 dataTransfer，需手动挂） */
function dispatchDrop(target: Element, files: File[]) {
    const event = createEvent.drop(target)
    Object.defineProperty(event, 'dataTransfer', { value: { files } })
    fireEvent(target, event)
}

describe('ChatComposer local 只读态附件闸', () => {
    it('local 只读态：拖放文件不触发上传、不弹附件卡', () => {
        renderComposer({ mode: 'local' })
        // 遮罩已盖住输入区（前置确认）
        expect(screen.getByText('composer.localModeReadonly')).toBeInTheDocument()

        // drop 落在遮罩文本上（真实场景：遮罩无 stopPropagation，事件冒泡到 wrapper 命中 handler）
        dispatchDrop(screen.getByText('composer.localModeReadonly'), [makeFile()])

        expect(uploadFileSpy).not.toHaveBeenCalled()
        expect(screen.queryByText('a.txt')).toBeNull()
    })

    it('正常模式：拖放文件仍可上传（防误伤）', async () => {
        renderComposer({}) // mode 缺省 = 正常会话

        // drop 落在 composer-card（wrapper 的后代）：冒泡命中 wrapper 的 React onDrop；
        // 刻意不落编辑器元素——jsdom 无 elementFromPoint，ProseMirror 原生 drop handler
        // 会在 posAtCoords 处抛错（测试无关噪声）
        const card = document.querySelector('.composer-card') as HTMLElement
        dispatchDrop(card, [makeFile()])

        await waitFor(() => {
            expect(uploadFileSpy).toHaveBeenCalledWith(makeFile(), expect.objectContaining({ onProgress: expect.any(Function) }))
        })
        // 附件卡正常出现
        await waitFor(() => {
            expect(screen.getByText('a.txt')).toBeInTheDocument()
        })
    })

    it('local 只读态：发送钮卸载；正常模式发送钮在场（同一断言对照）', () => {
        const { unmount } = renderComposer({ mode: 'local' })
        // SubmitButton（composer 内唯一 ArrowUpOutlined 使用方）应随遮罩卸载
        expect(document.querySelector('.anticon-arrow-up')).toBeNull()
        unmount()

        renderComposer({}) // 正常模式：发送钮在场
        expect(document.querySelector('.anticon-arrow-up')).not.toBeNull()
    })
})

/** useComposerScaffold 粘贴闸测试壳：把 handlePasteNative 接到 document 级 paste 监听
 * （模拟 ChatInput 的接入面），attachmentsDisabled 即 ChatComposer 传入的控件禁用谓词 */
function PasteHarness({ disabled }: { disabled: boolean }) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const shellRef = useRef<ChatInputHandle | null>(null)
    const { handlePasteNative } = useComposerScaffold({
        capTarget: null,
        workingDir: undefined,
        text: '',
        wrapperRef,
        shellRef,
        onTextChange: () => {},
        attachmentsDisabled: disabled,
        attachmentSessionId: undefined,
    })
    useEffect(() => {
        const handler = (e: Event) => { handlePasteNative(e as ClipboardEvent) }
        document.addEventListener('paste', handler)
        return () => document.removeEventListener('paste', handler)
    }, [handlePasteNative])
    return <div ref={wrapperRef} />
}

function renderPasteHarness(disabled: boolean) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <App>
                <PasteHarness disabled={disabled} />
            </App>
        </QueryClientProvider>,
    )
}

/** 在 document 上派发带 clipboardData 的 paste 事件（单文件项，模拟截图/文件粘贴） */
function dispatchPasteWithFile() {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
        value: {
            items: [{ kind: 'file', getAsFile: () => makeFile('pasted.txt') }],
            getData: () => '',
        },
    })
    fireEvent(document, event)
}

describe('useComposerScaffold 粘贴附件闸', () => {
    it('attachmentsDisabled 时：粘贴文件不上传（local 只读态短路）', () => {
        renderPasteHarness(true)
        dispatchPasteWithFile()
        expect(uploadFileSpy).not.toHaveBeenCalled()
    })

    it('未禁用时：粘贴文件仍上传（防误伤）', () => {
        renderPasteHarness(false)
        dispatchPasteWithFile()
        expect(uploadFileSpy).toHaveBeenCalled()
    })
})
