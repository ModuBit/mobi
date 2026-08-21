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

/** 方向确认迟滞（px）：越过才认手势，防误触（Apple 手势设计） */
export const HYSTERESIS = 10

/**
 * 左缘右滑的触发判定：起点在热区内 + 位移越过迟滞阈值（正方向为右）。
 *
 * 抽成纯函数以便单测覆盖边界（热区外起手 / 未过迟滞 / 反向滑动）。
 */
export function shouldTriggerSwipe(startX: number, currentX: number): boolean {
    if (startX > EDGE_WIDTH) return false
    return currentX - startX > HYSTERESIS
}
