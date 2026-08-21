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

/** 左缘热区宽度（px）——只认从屏幕最左缘起手的右滑 */
export const EDGE_WIDTH = 20

/** 方向确认迟滞（px）：位移越过才判方向，防误触（Apple 手势设计） */
export const HYSTERESIS = 10

/** 边缘滑动方向判定结果 */
export type EdgeSwipeDirection = 'pending' | 'horizontal' | 'vertical'

/**
 * 左缘起手滑动的方向锁判定。
 *
 * - 两轴位移均未过迟滞 → 'pending'（继续观察，不判定）
 * - **右滑**（dx > 0）且水平分量胜出 → 'horizontal'（返回意图，开菜单）
 * - 其余（垂直分量胜出 / 向左滑）→ 'vertical'（放弃跟踪交还浏览器）
 *
 * 水平意图必须辨正负：起手可在热区内任意位置（x 最大 EDGE_WIDTH），
 * 向左滑 10px+ 完全可达——左滑（远离屏幕缘）不是返回意图，判 'vertical'
 * 放弃跟踪。旧实现取绝对值比较，左滑过迟滞也会被误判 horizontal 而弹出菜单。
 *
 * 方向锁是热区不拦截的关键：只有确认水平意图才动作，
 * 竖向滑动全程不被 preventDefault / touch-action 干扰。
 *
 * 抽成纯函数以便单测覆盖边界（未过迟滞 / 水平胜出 / 垂直胜出 / 对角近似 / 左滑）。
 * 起点是否在热区内由 pointerdown 捕获层负责，本函数不再判定起点。
 */
export function resolveEdgeSwipeDirection(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
): EdgeSwipeDirection {
    const dx = currentX - startX
    const dy = currentY - startY
    if (Math.abs(dx) <= HYSTERESIS && Math.abs(dy) <= HYSTERESIS) return 'pending'
    return dx > 0 && dx > Math.abs(dy) ? 'horizontal' : 'vertical'
}
