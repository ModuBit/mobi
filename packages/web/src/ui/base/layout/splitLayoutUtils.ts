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

/** 左侧最小占比默认值（安全宽度，左侧不可被拖到 0） */
export const DEFAULT_LEFT_MIN_RATIO = 0.2
/** 右侧占比低于此阈值视为收起（拖到接近右边缘自动收起） */
export const COLLAPSE_THRESHOLD = 0.02

/**
 * 由指针 clientX 与容器矩形计算左侧占比（splitRatio）。
 * clamp 到 [minRatio, 1]：左侧至少保留安全宽度，右侧最多占满。
 * rectWidth <= 0 时返回最小占比，避免除零。
 */
export function computeSplitRatio(
    clientX: number,
    rectLeft: number,
    rectWidth: number,
    minRatio: number = DEFAULT_LEFT_MIN_RATIO,
): number {
    if (rectWidth <= 0) return minRatio
    const raw = (clientX - rectLeft) / rectWidth
    return Math.min(1, Math.max(minRatio, raw))
}

/**
 * 拖动后判定是否应收起：**指针推过「分隔条视觉可达的最右位置」即收起**——
 * 该位置 = 右缘 - max(rightMinPx, COLLAPSE_THRESHOLD × 容器宽)。
 * rightMinPx 抬住右栏时分隔条停在下限处不再跟随指针（死区），指针继续右推意图已
 * 明确，越过下限点即收起；无下限时退化为「右侧占比 < COLLAPSE_THRESHOLD」原语义
 * （分隔条贴指针走，右缘容差带即触发）。直接判指针 ratio 会形成死区里毫无反馈的
 * 长路程（2026-11-11 code-review 实锤）。
 * @param clientX 指针位置；rectLeft/rectWidth 容器矩形；rightMinPx 右栏宽度下限
 */
export function shouldCollapseOnDrag(
    clientX: number,
    rectLeft: number,
    rectWidth: number,
    rightMinPx: number,
): boolean {
    if (rectWidth <= 0) return false
    return clientX > rectLeft + rectWidth - Math.max(rightMinPx, COLLAPSE_THRESHOLD * rectWidth)
}

/**
 * 按左占比计算右栏像素宽度，并施加最小宽度下限。
 * 下限兜住窄容器的比例坍缩：601px 容器 × 20% = 120px 时树列筛选框被压到不可用
 * （2026-11-11 实测），下限抬住后左栏按 containerWidth - 右栏宽相应收缩。
 * containerWidth <= 0（首帧未测量）时返回下限本身。
 */
export function rightPanePx(splitRatio: number, containerWidth: number, rightMinPx: number): number {
    if (containerWidth <= 0) return rightMinPx
    return Math.max(rightMinPx, (1 - splitRatio) * containerWidth)
}
