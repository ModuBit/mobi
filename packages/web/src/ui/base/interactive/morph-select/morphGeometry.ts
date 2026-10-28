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
 * morph 形变族的几何与偏好判定单源。
 *
 * morph-select（pill → 列表）与 morph-surface（pill → 面板）是同一条形变语言的两条
 * 出口：视口留白、展开圆角、触发器实测宽度必须一致，否则同一 pill 长成两种形状。
 * 此前这些值各自复制了一份、只靠注释维系同步（morphTiming 早有同样的教训），
 * 这里收成一个模块，两侧 import。
 */

import { useSyncExternalStore } from 'react'
import { useReducedMotion } from 'motion/react'

/** 展开态圆角（面板语言）：列表面与面板面共用 */
export const OPEN_RADIUS = 22

/** 展开面与视窗边缘的最小留白（定位回拉边界） */
export const EDGE_MARGIN = 12

/**
 * 收起态触发器的实测宽度（向上取整）。
 *
 * `getBoundingClientRect` 带亚像素、`offsetWidth` 取整，差半像素内向上取整——半个像素
 * 就够把标签压出省略号；祖先有缩放时 rect 也随之缩放，退回布局宽 + 1px 余量。
 */
export function measureTriggerWidth(node: HTMLElement): number {
    const exact = node.getBoundingClientRect().width
    const rounded = node.offsetWidth
    return Math.abs(exact - rounded) <= 0.5 ? Math.ceil(exact - 0.01) : rounded + 1
}

const subscribe = () => () => {}

/**
 * prefers-reduced-motion，且只在 hydration 之后采信：
 * 首帧服务端无从得知该偏好，提前采信会与客户端不一致。
 */
export function useReducedFlag(): boolean {
    const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
    return !!useReducedMotion() && hydrated
}
