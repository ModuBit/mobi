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
 * 可用视口与浮层放置（键盘/视觉视口几何单源）。
 *
 * 「浮层实际能看见的区域」分两源，此前有三处各算一遍（本文件旧身 keyboardGeometry、
 * features/chat/useKeyboardViewport、Combobox 的 measure）：
 *
 * - overlay 模式（`index.html` 首帧脚本对支持 VirtualKeyboard API 的浏览器置
 *   `overlaysContent = true`，Android Chrome/PWA）：键盘浮在内容上，visualViewport
 *   不缩、innerHeight 不变，两种「视口收缩」信号都不触发。键盘几何只能从
 *   `navigator.virtualKeyboard.boundingRect` 读，且 Chromium 只在键盘滑出动画结束后
 *   以终值触发 `geometrychange`（动画期间无从跟随）。
 * - 其余环境（iOS/Firefox）：键盘压矮 visualViewport，`offsetTop + height` 逐帧更新。
 *
 * 本模块提供三件事，消费端不再自行拼几何：
 * 1. {@link readUsableViewport}：可视区上下边（layout/fixed 坐标系）。键盘未弹出 /
 *    非 overlay 时底边就是视觉视口底边；overlay 模式下取键盘顶边，抽出动画中按上次
 *    高度预测（焦点在可编辑元素上时）。
 * 2. {@link subscribeViewportChange}：可视区变化统一订阅（visualViewport 的
 *    resize/scroll + 键盘 geometrychange + window resize），返回拆除器。
 * 3. {@link place}：纯函数，锚点矩形 + 内容高度 → 弹层方向 / 高度上限 / fixed 定位。
 *    无 DOM 依赖，分支可穷举测试。
 *
 * features/chat/useKeyboardViewport 的键盘 store（--kb-inset / CSS 过渡插值）仍归
 * 该处，但它的模式判定与可编辑焦点判据也来自这里——同一事实只定义一次。
 */

interface VirtualKeyboardLike {
    overlaysContent: boolean
    boundingRect: DOMRect
    addEventListener(type: 'geometrychange', listener: () => void): void
    removeEventListener(type: 'geometrychange', listener: () => void): void
}

function getVirtualKeyboard(): VirtualKeyboardLike | undefined {
    return (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
}

/** 焦点是否在可编辑元素（键盘弹出的前提；INPUT/TEXTAREA/contenteditable 覆盖全部输入面） */
export function isEditableElement(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

/** 当前是否 overlay 键盘模式（index.html 开关 + 浏览器支持共同决定） */
export function isKeyboardOverlayMode(): boolean {
    return getVirtualKeyboard()?.overlaysContent === true
}

/** overlay 模式下当前键盘高度（0 = 未弹出 / 无 API） */
export function getKeyboardOverlayHeight(): number {
    return Math.max(0, Math.round(getVirtualKeyboard()?.boundingRect.height ?? 0))
}

/** 上次上报的键盘高度：动画期间的预测值（无记忆时退回不预测，损失首次的同步性） */
let lastKeyboardHeight = 0

/**
 * 键盘顶边（视口坐标，即 `getBoundingClientRect` 的纵向坐标系）。
 * 键盘未弹出 / 非 overlay 模式 / 无 API 时返回 Infinity（可视底边不受键盘影响）。
 */
export function getKeyboardTop(): number {
    const vk = getVirtualKeyboard()
    if (!vk || !vk.overlaysContent) return Infinity
    const height = Math.round(vk.boundingRect.height)
    if (height > 0) {
        lastKeyboardHeight = height
        return vk.boundingRect.top
    }
    // 键盘正在抽出（geometrychange 尚未上报终值）：焦点在可编辑元素上时按上次高度
    // 预测，否则弹层会先按完整视口向下弹、等键盘落定再翻上来
    return isEditableElement(document.activeElement) && lastKeyboardHeight > 0
        ? window.innerHeight - lastKeyboardHeight
        : Infinity
}

/**
 * 订阅键盘几何变化。仅 overlay 模式有事件源（Chromium 在键盘开合动画结束后触发）；
 * 其余环境由 {@link subscribeViewportChange} 的 visualViewport 监听覆盖。返回拆除器。
 * 单独暴露给 features/chat/useKeyboardViewport：它的键盘 store 仍需自行分辨终值时刻
 *（focusin 预测的确认），不能走「可视区变了就重测」的粗粒度通知。
 */
export function subscribeKeyboardGeometry(listener: () => void): () => void {
    const vk = getVirtualKeyboard()
    if (!vk || !vk.overlaysContent) return () => {}
    vk.addEventListener('geometrychange', listener)
    return () => vk.removeEventListener('geometrychange', listener)
}

/** 可视区（布局坐标；fixed 定位与之同参照） */
export interface UsableViewport {
    /** 可视区顶边（visualViewport 偏移；无视觉视口时 0） */
    top: number
    /** 可视区底边：视觉视口底与键盘顶边取小 */
    bottom: number
}

/**
 * 当前可用视口（浮层避让的唯一读取口）。
 * 底边同时扣掉视觉视口与 overlay 键盘两种来源——只取其一会在另一模型上漏判。
 */
export function readUsableViewport(): UsableViewport {
    const vv = window.visualViewport
    const layoutHeight = window.innerHeight
    const visualBottom = vv ? vv.offsetTop + vv.height : layoutHeight
    return {
        top: vv ? vv.offsetTop : 0,
        bottom: Math.min(visualBottom, getKeyboardTop()),
    }
}

/**
 * 订阅可视区变化（页面滚动不算可视区变化，浮层跟随滚动由消费端自行处理）。
 * 三源合一：window resize（桌面窗口）、visualViewport resize/scroll（iOS/Android
 * resize 模型的键盘与地址栏）、键盘 geometrychange（overlay 模型）。返回拆除器。
 */
export function subscribeViewportChange(listener: () => void): () => void {
    const vv = window.visualViewport
    const unsubscribeKeyboard = subscribeKeyboardGeometry(listener)
    window.addEventListener('resize', listener)
    vv?.addEventListener('resize', listener)
    vv?.addEventListener('scroll', listener)
    return () => {
        unsubscribeKeyboard()
        window.removeEventListener('resize', listener)
        vv?.removeEventListener('resize', listener)
        vv?.removeEventListener('scroll', listener)
    }
}

/** 浮层放置输入：锚点、内容高度、可用视口与间距约定 */
export interface PlaceInput {
    /** 锚点矩形（触发器的 getBoundingClientRect） */
    anchor: { left: number; top: number; bottom: number; width: number }
    /**
     * 内容高度（自然高度与当前高度的较大者）。
     * 收窄后元素高度只剩可视部分，方向判定必须用未收窄时的自然高度，否则反复横跳——
     * 自然高度的跨测量记忆由调用方持有（它是随测量演进的状态，不属于纯函数）
     */
    contentHeight: number
    viewport: UsableViewport
    /** 布局视口高度（bottom 锚定的基准 = window.innerHeight） */
    layoutHeight: number
    /** 与触发器之间的间距 */
    gap: number
    /** 弹层自身内衬 + 描边（收窄时从可用高度里扣除） */
    chrome: number
    /** 列表最小高度：可用空间再小也至少给一行 */
    minListHeight: number
}

/** 浮层放置结果 */
export interface Placement {
    direction: 'up' | 'down'
    /** 内容区高度上限；null = 放得下，不设上限 */
    maxHeight: number | null
    /** fixed 定位（left/width 对齐锚点；向上弹用 bottom 锚定，高度动画时始终贴着触发器） */
    style: { left: number; width: number; top?: number; bottom?: number }
}

/**
 * 计算浮层放置：空间不足且上方更宽敞时向上弹；仍放不下则收窄高度（保底一行）。
 */
export function place(input: PlaceInput): Placement {
    const { anchor, contentHeight, viewport, layoutHeight, gap, chrome, minListHeight } = input
    // 上下可用空间都已扣掉与触发器之间的间距
    const below = viewport.bottom - anchor.bottom - gap
    const above = anchor.top - viewport.top - gap
    const needed = contentHeight + gap
    const direction = below < needed && above > below ? 'up' : 'down'
    const available = direction === 'up' ? above : below
    const maxHeight = available >= needed ? null : Math.max(minListHeight, available - chrome)
    const style = direction === 'up'
        ? { left: anchor.left, width: anchor.width, bottom: layoutHeight - anchor.top + gap }
        : { left: anchor.left, width: anchor.width, top: anchor.bottom + gap }
    return { direction, maxHeight, style }
}
