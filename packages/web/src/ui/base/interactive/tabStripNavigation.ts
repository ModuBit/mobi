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
 * TabStrip 的纯导航数学：键盘 → 目标索引、关闭后的焦点落点。
 *
 * 抽成纯函数是为了直测边界（端点不循环、连续 disabled、目标侧全 disabled）；
 * 组件侧只负责把 DOM 里的 tab 摊成数组再消费结果。下标一律是「tab 数组的位次」，
 * 含 disabled 项——跳过与否由本模块判断，调用方不预处理。
 */

export interface TabNavEntry {
    disabled?: boolean
}

/**
 * 方向键 / Home / End → 目标索引；无处可去（已在端点、目标侧全是 disabled、不认识的键）返回 null。
 * **端点不循环**：末项按右键停在原地，比绕回首项更符合「一连串页签」的空间直觉。
 */
export function resolveTabNavKey(key: string, current: number, tabs: readonly TabNavEntry[]): number | null {
    if (current < 0 || current >= tabs.length) return null
    switch (key) {
        case 'ArrowRight':
            return firstEnabled(tabs, current + 1, 1)
        case 'ArrowLeft':
            return firstEnabled(tabs, current - 1, -1)
        case 'Home':
            return firstEnabled(tabs, 0, 1)
        case 'End':
            return firstEnabled(tabs, tabs.length - 1, -1)
        default:
            return null
    }
}

/**
 * 关闭第 closedIndex 个 tab 后焦点的落点（返回「关闭后」数组里的下标，一个可用的都没有则 null）。
 * 从原位（后一项顶上来的位置，关末项时即前一项）向数组尾找，找不到再折回数组头找——
 * 关掉一个页签后焦点消失，比落到稍远的邻居身上糟糕得多。
 */
export function nextFocusAfterClose(closedIndex: number, remaining: readonly TabNavEntry[]): number | null {
    if (remaining.length === 0) return null
    const from = Math.min(Math.max(closedIndex, 0), remaining.length - 1)
    return firstEnabled(remaining, from, 1) ?? firstEnabled(remaining, from - 1, -1)
}

/** 从 from 起沿 step 找第一个启用的下标；走到边界都没有则 null */
function firstEnabled(tabs: readonly TabNavEntry[], from: number, step: 1 | -1): number | null {
    for (let i = from; i >= 0 && i < tabs.length; i += step) {
        if (!tabs[i].disabled) return i
    }
    return null
}
