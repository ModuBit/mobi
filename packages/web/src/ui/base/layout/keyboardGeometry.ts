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
 * 移动端虚拟键盘几何（浮层避让用）。
 *
 * 为什么不能只看 visualViewport：`index.html` 首帧脚本在支持 VirtualKeyboard API
 * 的浏览器（Android Chrome）上置 `overlaysContent = true`——键盘浮在内容上，
 * visualViewport 不缩、innerHeight 不变，两种「视口收缩」信号都不会触发。此模式下
 * 键盘几何只能从 `navigator.virtualKeyboard.boundingRect` 读，且 Chromium 只在键盘
 * 动画结束后以终值触发 `geometrychange`（动画期间无从跟随）。
 *
 * 故此处提供两件事：键盘顶边的统一读取（含「动画中按上次高度预测」，与
 * features/chat/useKeyboardViewport 的焦点预测同一理由）+ 几何变化订阅。
 * 无 API / 非 overlay 模式时返回 Infinity / 空订阅，消费端照常用 visualViewport 判定。
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

/** 上次上报的键盘高度：动画期间的预测值（无记忆时退回不预测，损失首次的同步性） */
let lastKeyboardHeight = 0

function isEditableFocused(): boolean {
    const el = document.activeElement
    if (!el) return false
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
    return (el as HTMLElement).isContentEditable === true
}

/** 当前是否 overlay 键盘模式（index.html 开关 + 浏览器支持共同决定） */
export function isKeyboardOverlayMode(): boolean {
    return getVirtualKeyboard()?.overlaysContent === true
}

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
    return isEditableFocused() && lastKeyboardHeight > 0
        ? window.innerHeight - lastKeyboardHeight
        : Infinity
}

/**
 * 订阅键盘几何变化。仅 overlay 模式有事件源（Chromium 在键盘开合动画结束后触发）；
 * 其余环境由消费端自行监听 visualViewport。返回拆除器。
 */
export function subscribeKeyboardGeometry(listener: () => void): () => void {
    const vk = getVirtualKeyboard()
    if (!vk || !vk.overlaysContent) return () => {}
    vk.addEventListener('geometrychange', listener)
    return () => vk.removeEventListener('geometrychange', listener)
}
