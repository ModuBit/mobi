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

/** 速度采样窗口（ms）：只看最近这一段位移；松手前停顿会掉动量（慢而稳的释放落回原处） */
const VELOCITY_WINDOW_MS = 80
/** 采样失效门（ms）：最后一个采样点离松手太远说明手势早已停住，按零速度算 */
const VELOCITY_STALE_MS = 60

/** 一次指针采样（时间戳 + 纵向位置），拖动中滚动保留最近若干个 */
export interface DragSample {
    t: number
    y: number
}

/**
 * 释放速度（px/s，向下为正）——与 `resolveDragDisposition` 是一对：那个决定去向，这个
 * 喂给它速度。抽在这里是因为**两个使用方**（BottomSheet 的档位拖拽、画板的头部下拉）
 * 必须用同一套判据，各抄一份必然漂（窗口宽度、停顿时效都是调出来的值，不是随手写的）。
 */
export function dragVelocity(samples: readonly DragSample[], now: number): number {
    const recent = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS)
    const first = recent[0]
    const last = recent[recent.length - 1]
    if (!first || !last || last === first || now - last.t > VELOCITY_STALE_MS) return 0
    return (last.y - first.y) / ((last.t - first.t) / 1000)
}

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
