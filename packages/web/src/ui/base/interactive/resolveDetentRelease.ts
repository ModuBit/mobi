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

/** 释放点向前投影的时间（秒）：按「松手后还会滑多远」选档，而不是按当前位置 */
const PROJECTION = 0.2
/** 甩动阈值（px/s）：超过即至少跨一档，慢速释放才按投影落最近档 */
const FLICK = 320

/**
 * 多档 sheet 释放后的落档判定（BottomSheet 的停靠点；单档用 resolveDragDisposition）。
 *
 * 与两档版（关闭/回位）的区别：档位多了以后，「位置过阈值」不再是好判据——
 * 用户可能从展开档轻推一下只想收到 peek，也可能在 peek 档快甩想直接关掉。
 * 故取 uiarc 的思路：把松手位置按速度向前投影，落到最近的档；速度超过 FLICK
 * 时强制跨至少一档（方向由速度符号定），保证「快甩」的手感不依赖当前位置。
 *
 * @param offset 当前位移（px，向下为正）
 * @param velocity 释放速度（px/s，向下为正）
 * @param detents 各档位移，升序（如 [0, peekY, closedY]）
 * @param from 起手所在档（下标）：快甩时决定往哪个方向跨一档
 * @returns 落档下标（detents 里的索引）
 */
export function resolveDetentRelease({
    offset,
    velocity,
    detents,
    from,
}: {
    offset: number
    velocity: number
    detents: number[]
    from: number
}): number {
    const projected = offset + velocity * PROJECTION
    let best = 0
    for (let index = 1; index < detents.length; index++) {
        if (Math.abs(detents[index] - projected) < Math.abs(detents[best] - projected)) {
            best = index
        }
    }
    if (Math.abs(velocity) > FLICK) {
        // 快速下甩至少往下一档（peek → closed、top → peek），快速上推至少往上一档
        const floor = velocity > 0 ? Math.min(from + 1, detents.length - 1) : Math.max(from - 1, 0)
        best = velocity > 0 ? Math.max(best, floor) : Math.min(best, floor)
    }
    return best
}
