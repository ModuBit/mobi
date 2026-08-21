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
 * - 水平分量胜出 → 'horizontal'（右滑意图，开菜单）
 * - 垂直分量胜出 → 'vertical'（用户在滚动，放弃跟踪交还浏览器）
 *
 * 方向锁是热区不拦截的关键：只有确认水平意图才动作，
 * 竖向滑动全程不被 preventDefault / touch-action 干扰。
 *
 * 抽成纯函数以便单测覆盖边界（未过迟滞 / 水平胜出 / 垂直胜出 / 对角近似）。
 * 起点 是否在热区内由 pointerdown 捕获层负责，本函数不再判定起点。
 */
export function resolveEdgeSwipeDirection(
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
): EdgeSwipeDirection {
    const dx = Math.abs(currentX - startX)
    const dy = Math.abs(currentY - startY)
    if (dx <= HYSTERESIS && dy <= HYSTERESIS) return 'pending'
    return dx > dy ? 'horizontal' : 'vertical'
}
