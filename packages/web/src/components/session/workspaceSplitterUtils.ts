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

/** 左侧最小占比（安全宽度，左侧不可被拖到 0） */
export const LEFT_MIN_RATIO = 0.2
/** 右侧占比低于此阈值视为收起（拖到接近右边缘自动收起） */
export const COLLAPSE_THRESHOLD = 0.02

/**
 * 由指针 clientX 与容器矩形计算左侧占比（splitRatio）。
 * clamp 到 [LEFT_MIN_RATIO, 1]：左侧至少保留安全宽度，右侧最多占满。
 * rectWidth <= 0 时返回最小占比，避免除零。
 */
export function computeSplitRatio(
    clientX: number,
    rectLeft: number,
    rectWidth: number,
): number {
    if (rectWidth <= 0) return LEFT_MIN_RATIO
    const raw = (clientX - rectLeft) / rectWidth
    return Math.min(1, Math.max(LEFT_MIN_RATIO, raw))
}

/**
 * 拖动后判定是否应收起：右侧占比 < 阈值即收起。
 * @param splitRatio 左侧占比（0~1）
 */
export function shouldCollapseOnDrag(splitRatio: number): boolean {
    return 1 - splitRatio < COLLAPSE_THRESHOLD
}
