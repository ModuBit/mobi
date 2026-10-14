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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { App as AntApp } from 'antd'
import { sceneFingerprint, type SketchCanvasHandle } from '@/features/sketchpad/SketchCanvas'
import { Z_OVERLAY } from '@/core/config/theme/cssVars'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/** fake imperative API：可变的场景内容（供「先捕获、后修改」的时序模拟）；
 *  updateScene 真实生效（载入的 elements 写回 state），支撑重编辑未动笔场景 */
function makeFakeApi() {
    const state = {
        elements: [] as Record<string, unknown>[],
        viewBackgroundColor: '#ffffff',
    }
    const api = {
        getSceneElements: () => state.elements,
        getAppState: () => ({ viewBackgroundColor: state.viewBackgroundColor }),
        updateScene: vi.fn((update: { elements?: readonly unknown[] }) => {
            if (update?.elements) state.elements = [...update.elements] as Record<string, unknown>[]
        }),
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

import { SketchCanvas } from '@/features/sketchpad/SketchCanvas'

function renderCanvas(onCancel: () => void, opts: { initialSketch?: Blob | null } = {}) {
    let handle: SketchCanvasHandle | null = null
    const view = render(
        <AntApp>
            <SketchCanvas
                ref={(h: SketchCanvasHandle | null) => { handle = h }}
                initialSketch={opts.initialSketch ?? null}
                onCancel={onCancel}
            />
        </AntApp>,
    )
    return {
        view,
        requestCancel: () => handle?.requestCancel(),
        complete: () => handle?.complete(),
        canvasHandle: () => handle,
    }
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

    /** 层号写死会在移动端画板领号（overlayLayer，1080 起）之后被自己的载体压住——点不到 */
    it('确认框层号取自浮层分配器（不写死）', async () => {
        fakeApiHost = makeFakeApi()
        const { requestCancel } = renderCanvas(vi.fn())
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        act(() => {
            fakeApiHost!.state.elements.push({ id: 'e1', type: 'freedraw', x: 1, y: 1 })
        })
        await act(async () => {
            requestCancel()
        })
        await waitFor(() => { expect(document.querySelector('.ant-modal-wrap')).toBeTruthy() })
        const z = Math.max(
            ...['.ant-modal-wrap', '.ant-modal-mask'].map((sel) => Number((document.querySelector(sel) as HTMLElement)?.style.zIndex || 0)),
        )
        expect(z).toBeGreaterThanOrEqual(Z_OVERLAY)
    })

    /** 宿主（画板载体）的 ESC 监听靠它让路，否则 ESC 关掉确认框后会被重新弹出 */
    it('isConfirmOpen：确认框弹出/取消时如实反映', async () => {        fakeApiHost = makeFakeApi()
        const { requestCancel, canvasHandle } = renderCanvas(vi.fn())
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        expect(canvasHandle()!.isConfirmOpen()).toBe(false)
        act(() => {
            fakeApiHost!.state.elements.push({ id: 'e1', type: 'freedraw', x: 1, y: 1 })
        })
        await act(async () => {
            requestCancel()
        })
        expect(canvasHandle()!.isConfirmOpen()).toBe(true)
        // 取消（不放弃修改）：关掉确认框，画布继续开着
        const cancelBtn = document.querySelector('.ant-modal-confirm-btns button') as HTMLElement
        await act(async () => {
            fireEvent.click(cancelBtn)
        })
        expect(canvasHandle()!.isConfirmOpen()).toBe(false)
    })

    /**
     * 取消是幂等的：请求来自多条通道（头部取消 / ESC / 下拉 / 遮罩 / **系统返回**），其中
     * 系统返回不经过任何在屏判据——手持设备连按返回会在确认框之上再叠一层一模一样的框
     * （真机实测 1 → 2），既不在宿主的 ESC 让路判据里，也不属于「否决后回位」的语义。
     */
    it('确认框已在上时，再次 requestCancel 不叠第二层', async () => {
        fakeApiHost = makeFakeApi()
        const onCancel = vi.fn()
        const { requestCancel } = renderCanvas(onCancel)
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        act(() => {
            fakeApiHost!.state.elements.push({ id: 'e1', type: 'freedraw', x: 1, y: 1 })
        })
        await act(async () => {
            requestCancel()
        })
        await waitFor(() => { expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(1) })
        await act(async () => {
            requestCancel()
        })
        expect(document.querySelectorAll('.ant-modal-confirm')).toHaveLength(1)
        expect(onCancel).not.toHaveBeenCalled()
    })
})

describe('SketchCanvas 完成语义的 unchanged 分流', () => {
    afterEach(cleanup)

    it('重编辑未动笔（载入后指纹未变）→ complete 返回 unchanged，不触发导出', async () => {
        const { loadSketch } = await import('@/domain/sketch/sketchFile')
        vi.mocked(loadSketch).mockResolvedValue({
            elements: [{ id: 'e0', type: 'rectangle', x: 0, y: 0 }],
            appState: {},
            files: {},
        })
        fakeApiHost = makeFakeApi()
        const { complete } = renderCanvas(vi.fn(), { initialSketch: new Blob(['png']) })
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        // 场景已载入内容（1 个元素）且动过笔检测基准已捕获，但用户未再修改
        expect(fakeApiHost!.state.elements).toHaveLength(1)
        await act(async () => {
            await expect(complete()).resolves.toBe('unchanged')
        })
        const { exportSketch } = await import('@/domain/sketch/sketchFile')
        expect(exportSketch).not.toHaveBeenCalled()
    })

    it('动笔后完成 → 走导出（免上传判据与取消确认同源）', async () => {
        fakeApiHost = makeFakeApi()
        const { complete } = renderCanvas(vi.fn())
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10))
        })
        act(() => {
            fakeApiHost!.state.elements.push({ id: 'e1', type: 'freedraw', x: 1, y: 1 })
        })
        await act(async () => {
            await complete()
        })
        const { exportSketch } = await import('@/domain/sketch/sketchFile')
        expect(exportSketch).toHaveBeenCalledTimes(1)
    })
})

/**
 * 主题重绑的接缝锁（读源码不渲染——这层全是 CSS 变量声明，jsdom 看不到效果）。
 * 锁两件事：① 覆盖规则必须压过上游同权重声明；② 强调色族不再留上游那套淡紫。
 */
describe('SketchCanvas 画布主题重绑', () => {
    /** 只看代码：源码注释里会引「上游那套值」来说明改了什么（那是文档不是实现），
        对否定断言必须先剥注释，否则会因为解释文字而误判 */
    const code = readFileSync(join(process.cwd(), 'src/features/sketchpad/SketchCanvas.tsx'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')

    it('覆盖选择器叠一次自身类：与上游 .excalidraw(0,1,0) / .theme--dark(0,2,0) 平权重时不能靠注入顺序赌', () => {
        expect(code).toContain('.excalidraw.excalidraw')
        expect(code).toContain('.excalidraw.theme--dark.excalidraw')
    })

    it('强调色族绑到净墨（不再有淡紫 hex）', () => {
        expect(code).toMatch(/--color-primary: var\(--mobi-ink\)/)
        expect(code).toMatch(/--color-primary-light: var\(--mobi-selected\)/)
        expect(code).not.toMatch(/#6965db|#a8a5ff|#e3e2fe/i)
    })

    /**
     * 框选矩形是唯一被 JS 读走画在 canvas 上的变量（会跟着暗档的反显滤镜翻转）：
     * 填的必须是**画布存储色**且取中调——取深墨在暗档反显成近黑、取浅色在明档糊在白纸上，
     * 两档各有一种会「选中框消失」。
     */
    it('框选色取中调（唯一随画布反显的变量）', () => {
        expect(code).toMatch(/--color-selection: var\(--mobi-ink-tertiary\)/)
    })

    /** 画布内容与导出走 JS 渲染（暗色是 canvas 的 CSS 反显）：碰这两个变量会改变存储色 */
    it('不碰画布本身的底色与反显滤镜', () => {
        expect(code).not.toContain('--default-bg-color')
        expect(code).not.toContain('--theme-filter')
    })

    /** --ant-* 只在 antd 子树内可解析，而移动端本组件 portal 到 body → 暗色回落白底 */
    it('画布底色取全局变量，不用 antd 子树变量', () => {
        expect(code).toContain('background: var(--mobi-elevated')
        expect(code).not.toContain('--ant-color-bg-container')
    })
})
