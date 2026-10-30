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
 * 甩动成立的最小行程（px）：从起手到松手手指真实走过的距离。低于它的「高速度」不是甩，
 * 是抖动点按的收尾——触摸采样合并后，10~20px 的落点滚动在 80ms 窗里能算出 300~600px/s
 * 的瞬时速度，只看速度会把一次普通点按判成「快甩关闭」（真机表现：点会话行，菜单被甩走、
 * click 被吞，2026-10-30 移动端菜单导航丢导航的根因之一）。32 = 4× 手势起手阈
 * （GESTURE_SLOP_PX），真甩（≥50px）远在其上。速度判据的两个使用方共用这一个门槛。
 */
export const MIN_FLICK_TRAVEL_PX = 32

/**
 * 「这一落点不归拖拽」的选择器：落在真控件上的按下不接管手势——按钮 / 链接 / 输入要能按，
 * 标题上的长按选择也要能选。
 *
 * 与 `resolveDragDisposition` 同处是因为这是同一次判定的前置：**两个使用方**（BottomSheet
 * 的头部拖拽、画板的头部下拉）必须用同一套落点判据。曾各写一份并已分叉（一处有
 * `[contenteditable]`、一处没有），漏掉的那边会让标题长按选字失效。
 */
export const DRAG_EXEMPT_SELECTOR = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'

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
 *
 * 「快甩」必须两个条件同时成立：速度显著 **且** 行程达 `MIN_FLICK_TRAVEL_PX`——
 * 高瞬时速度只证明松手那一下快，不证明用户甩了。
 */
export function resolveDragDisposition(
    { offset, velocity, height, travel }: { offset: number; velocity: number; height: number; travel: number },
): 'close' | 'settle' {
    if (velocity > VELOCITY_THRESHOLD && travel >= MIN_FLICK_TRAVEL_PX) return 'close'
    if (velocity < -VELOCITY_THRESHOLD) return 'settle'
    return offset > height / 3 ? 'close' : 'settle'
}
