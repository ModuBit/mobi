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

/** 释放速度判定阈值（px/s）：超过即按速度符号决定，快甩快收 */
const VELOCITY_THRESHOLD = 500

/**
 * Drawer 拖拽释放后的去向判定。
 *
 * Apple 原则：用**速度符号**而非位置决定 reverse vs commit——
 * 快甩（大幅向下速度）即使位移小也应关闭（用户的意图是扔出去）；
 * 快速上推（负速度）即使拖过阈值也应回位（用户改变了主意）。
 * 速度不显著时回落到位置阈值（sheet 高度 1/3）。
 */
export function resolveDragDisposition(
    { offset, velocity, height }: { offset: number; velocity: number; height: number },
): 'close' | 'settle' {
    if (velocity > VELOCITY_THRESHOLD) return 'close'
    if (velocity < -VELOCITY_THRESHOLD) return 'settle'
    return offset > height / 3 ? 'close' : 'settle'
}
