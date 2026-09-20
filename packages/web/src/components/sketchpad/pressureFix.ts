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
 * 压感事件层修正（治本，PoC 真机验证）：excalidraw 以「pointer 事件 pressure === 0.5」
 * 判定压感来源，Android 手指/触控笔上报非 0.5 的接触面积压力会被误入恒定压力分支
 * （均匀笔画）。在 window 捕获阶段把指针事件 pressure 改写为 0.5 后向原目标重派发——
 * 全设备统一速度模拟、绘制全程实时锥形，落笔无突变。
 *
 * 从 SketchCanvas 抽出：对 excalidraw 的唯一耦合是 editor 手柄的窄接口，
 * 可用假 editor + 合成 PointerEvent 直接测试（不必挂载 excalidraw）。
 */

import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

/** editor 手柄的窄接口（仅压感修正所需） */
export interface PressureFixEditor {
    getSceneElements(): readonly ExcalidrawElement[]
    updateScene(opts: { elements: readonly ExcalidrawElement[]; captureUpdate: 'NEVER' }): void
}

/** 防抖兜底间隔：笔画进行中 onChange 逐点连发，落笔停顿后再做形状等价改写 */
export const PRESSURE_FIX_DEBOUNCE_MS = 400

/**
 * 单事件改写：非 0.5 pressure 的真实指针事件按 0.5 重派发到原目标。
 * 合成事件（isTrusted=false）直接放行，避免重派发自拦截死循环。
 */
export function rewritePointerPressure(e: PointerEvent): void {
    if (!e.isTrusted || e.pressure === 0.5) return
    e.stopPropagation()
    ;(e.target as EventTarget).dispatchEvent(new PointerEvent(e.type, {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isPrimary: e.isPrimary,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        pressure: 0.5,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        twist: e.twist,
        width: e.width,
        height: e.height,
        buttons: e.buttons,
        button: e.button,
        bubbles: true,
        cancelable: true,
        composed: true,
    }))
}

/**
 * 挂载 window 捕获层的改写监听：捕获阶段先于 excalidraw（canvas/容器/React 委托）
 * 收到任何指针事件。返回卸载函数。
 */
export function attachPressureRewrite(): () => void {
    const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const
    for (const type of types) window.addEventListener(type, rewritePointerPressure, true)
    return () => {
        for (const type of types) window.removeEventListener(type, rewritePointerPressure, true)
    }
}

/**
 * 防抖兜底：仍走真实压力分支的笔画（如修正挂载前画的），落笔停顿后把「压力非 0.5
 * 分支」翻回速度模拟。captureUpdate: NEVER——形状数据等价改写不进 undo 栈。
 * dispose 丢弃未触发的兜底（组件卸载 / editor 更换）。
 */
export function createPressureFixer(editor: PressureFixEditor) {
    let timer: number | null = null
    return {
        /** 挂到 excalidraw onChange：有候选笔画时防抖触发等价改写 */
        onChange() {
            const hasCandidate = editor.getSceneElements().some(el => el.type === 'freedraw' && !el.simulatePressure)
            if (!hasCandidate) return
            if (timer !== null) window.clearTimeout(timer)
            timer = window.setTimeout(() => {
                timer = null
                let changed = false
                const next = editor.getSceneElements().map(el => {
                    if (el.type !== 'freedraw' || el.simulatePressure) return el
                    changed = true
                    return { ...el, simulatePressure: true, pressures: [] }
                })
                if (changed) {
                    editor.updateScene({ elements: next, captureUpdate: 'NEVER' })
                }
            }, PRESSURE_FIX_DEBOUNCE_MS)
        },
        dispose() {
            if (timer !== null) {
                window.clearTimeout(timer)
                timer = null
            }
        },
    }
}
