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
 * SketchCanvas 测试：取消确认的「有无修改」指纹检测可在 jsdom 断言的部分。
 * excalidraw 组件以桩替换（注入 fake imperative API）；指纹比对逻辑用真实实现。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { sceneFingerprint, type SketchCanvasHandle } from '@/components/sketchpad/SketchCanvas'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/** fake imperative API：可变的场景内容（供「先捕获、后修改」的时序模拟） */
function makeFakeApi() {
    const state = {
        elements: [] as Record<string, unknown>[],
        viewBackgroundColor: '#ffffff',
    }
    const api = {
        getSceneElements: () => state.elements,
        getAppState: () => ({ viewBackgroundColor: state.viewBackgroundColor }),
        updateScene: vi.fn(),
        addFiles: vi.fn(),
    }
    return { api, state }
}

describe('sceneFingerprint', () => {
    it('簿记字段（version/versionNonce/updated）变化不影响指纹', () => {
        const base = { id: 'e1', type: 'rectangle', x: 0, y: 0 }
        const a = { ...base, version: 1, versionNonce: 111, updated: 100 }
        const b = { ...base, version: 9, versionNonce: 999, updated: 200 }
        const api = { getSceneElements: () => [a], getAppState: () => ({ viewBackgroundColor: '#fff' }) }
        const api2 = { getSceneElements: () => [b], getAppState: () => ({ viewBackgroundColor: '#fff' }) }
        expect(sceneFingerprint(api as unknown as ExcalidrawImperativeAPI))
            .toBe(sceneFingerprint(api2 as unknown as ExcalidrawImperativeAPI))
    })

    it('背景色变化改变指纹（changeViewBackgroundColor 开启，属用户内容）', () => {
        const api = { getSceneElements: () => [], getAppState: () => ({ viewBackgroundColor: '#fff' }) }
        const api2 = { getSceneElements: () => [], getAppState: () => ({ viewBackgroundColor: '#000' }) }
        expect(sceneFingerprint(api as unknown as ExcalidrawImperativeAPI))
            .not.toBe(sceneFingerprint(api2 as unknown as ExcalidrawImperativeAPI))
    })
})

// excalidraw 组件桩：渲染 null，首帧把 fake api 注入组件（时序模拟真实 excalidrawAPI 回调）
let fakeApiHost: ReturnType<typeof makeFakeApi> | null = null
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: ({ excalidrawAPI }: { excalidrawAPI: (api: unknown) => void }) => {
        if (fakeApiHost) excalidrawAPI(fakeApiHost.api as unknown as never)
        return null
    },
}))

vi.mock('@/domain/sketch/sketchFile', () => ({
    exportSketch: vi.fn(async () => null),
    loadSketch: vi.fn(async () => ({ elements: [], appState: {}, files: {} })),
    sketchFilename: () => '草图-test.excalidraw.png',
    SKETCH_MARK: { format: 'excalidraw.png' },
}))

import { SketchCanvas } from '@/components/sketchpad/SketchCanvas'

function renderCanvas(onCancel: () => void) {
    let handle: SketchCanvasHandle | null = null
    const view = render(
        <AntApp>
            <SketchCanvas
                ref={(h: SketchCanvasHandle | null) => { handle = h }}
                onCancel={onCancel}
            />
        </AntApp>,
    )
    return { view, requestCancel: () => handle?.requestCancel() }
}

describe('SketchCanvas 取消确认的变更检测', () => {
    afterEach(cleanup)

    it('画布未修改：取消直接关闭，不弹确认', async () => {
        fakeApiHost = makeFakeApi()
        const onCancel = vi.fn()
        const { requestCancel } = renderCanvas(onCancel)
        // 等 editor 注入 + 指纹捕获（setTimeout 0）
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        await act(async () => {
            requestCancel()
        })
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('画布有修改：取消弹确认拦截，onCancel 不立即执行', async () => {
        fakeApiHost = makeFakeApi()
        const onCancel = vi.fn()
        const { requestCancel } = renderCanvas(onCancel)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        // 模拟用户画了一笔（场景内容变化）
        act(() => {
            fakeApiHost!.state.elements.push({ id: 'e1', type: 'freedraw', x: 1, y: 1 })
        })
        await act(async () => {
            requestCancel()
        })
        // 确认框弹出，onCancel 尚未执行（须用户确认才关）
        expect(onCancel).not.toHaveBeenCalled()
        await waitFor(() => {
            expect(document.querySelector('.ant-modal-confirm')).toBeTruthy()
        })
    })
})
