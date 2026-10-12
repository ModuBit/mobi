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
 * 选区引用浮层族（QuoteSelectionPopover / QuoteCommentInput）共享的定位规则：
 * fixed 定位锚定选区几何（viewport 坐标）——默认在选区上方（底边贴选区顶边），
 * 选区太靠顶时翻到下方（不做逐边翻转兜底）；水平取选区中心，越出视口边缘时钳回
 * （移动端窄屏/选区贴近边缘的兜底）。规则一处承载，两浮层只声明各自差异
 * （宽度与翻转阈值），不再各写一遍公式。
 */

/** 浮层与选区的间距（px）：上方放置时浮层底边距选区顶边，下方放置时对称 */
export const QUOTE_LAYER_GAP = 8

/** 距视口左右边缘的最小间距（fixed 定位无滚动兜底，窄屏必须钳制） */
export const QUOTE_LAYER_VIEWPORT_MARGIN = 8

export interface QuoteLayerPlacement {
    top: number
    left: number
    /** 是否翻转到选区上方（true 时配合 `translateY(-100%)` 使用） */
    above: boolean
}

/**
 * 计算浮层相对选区矩形的定位（纯函数，window.innerWidth/innerHeight 只读视口尺寸）。
 *
 * @param rect           选区几何（getBoundingClientRect 产物，viewport 坐标）
 * @param width          浮层宽度（各浮层自声明）
 * @param flipThreshold  选区顶边高于此值（px）才放上方，否则翻到下方（各浮层自声明：
 *                       评论浮层更高，阈值相应更大）
 * @param estimatedHeight 浮层估算高度：下方放置时据此钳回视口下缘——顶部起选、拖到
 *                        接近视口底的大选区不钳的话，确认/取消按钮落进视口外不可点。
 *                        估算值只用于钳制兜底，不必精确
 * @param preferBelow    优先放选区下方（移动端）：系统文本选择菜单（复制/全选…）
 *                       覆盖在选区上方，同侧弹出会被盖住（2026-09-23 真机实测）；
 *                       下方放不下（距视口下缘不足）时仍翻回上方
 */
export function computeQuoteLayerPlacement(
    rect: DOMRect,
    width: number,
    flipThreshold: number,
    estimatedHeight: number,
    preferBelow = false,
): QuoteLayerPlacement {
    const belowFits = rect.bottom + QUOTE_LAYER_GAP + estimatedHeight + QUOTE_LAYER_VIEWPORT_MARGIN
        <= window.innerHeight
    const above = preferBelow ? !belowFits : rect.top > flipThreshold
    let top = above ? rect.top - QUOTE_LAYER_GAP : rect.bottom + QUOTE_LAYER_GAP
    const left = Math.min(
        Math.max(rect.left + rect.width / 2 - width / 2, QUOTE_LAYER_VIEWPORT_MARGIN),
        Math.max(window.innerWidth - width - QUOTE_LAYER_VIEWPORT_MARGIN, QUOTE_LAYER_VIEWPORT_MARGIN),
    )
    if (!above) {
        top = Math.min(top, window.innerHeight - estimatedHeight - QUOTE_LAYER_VIEWPORT_MARGIN)
        top = Math.max(top, QUOTE_LAYER_VIEWPORT_MARGIN)
    }
    return { top, left, above }
}
