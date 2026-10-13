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
 * 工具视图的呈现上下文。
 *
 * 同一批视图组件（EditView / WriteView / MultiEditView / ResultView…）既渲染在消息卡里，
 * 也渲染在工具详情 sheet / 抽屉里，**差别只在「内容该多高」**：卡内必须给上限（一张千行
 * diff 不能把消息流撑爆），详情容器里要给全高——容器自己就是滚动区，里面再嵌一层高度受限的
 * 滚动区就成了双滚动（真机反馈：「diff 里为什么会有竖向滚动条」，且外层滚不动里层）。
 *
 * 用 context 而不是逐层传 prop：视图由 `getToolFullViewComponent(tool.name)` 动态选出，
 * 形状统一在 `ToolViewProps`，为一个「谁在用我」的差异去污染所有视图的入参不划算。
 * 值本身就是那个数（`null` 表不限高），不再包一层对象——只有 diff 一项消费它，
 * 多一层壳只让每个消费点都多写一次解构。
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** 消息卡内 diff 的高度上限（px）：超过就内滚 */
export const INLINE_DIFF_MAX_HEIGHT = 320

/** 值 = diff 高度上限；null = 不限高（容器自己滚） */
const ToolDiffMaxHeightContext = createContext<number | null>(INLINE_DIFF_MAX_HEIGHT)

/** fullHeight：所在容器自己负责滚动（工具详情 sheet / 抽屉），内容一律全高 */
export function ToolViewScopeProvider({ fullHeight = false, children }: {
    fullHeight?: boolean
    children: ReactNode
}) {
    return (
        <ToolDiffMaxHeightContext.Provider value={fullHeight ? null : INLINE_DIFF_MAX_HEIGHT}>
            {children}
        </ToolDiffMaxHeightContext.Provider>
    )
}

export function useToolDiffMaxHeight(): number | null {
    return useContext(ToolDiffMaxHeightContext)
}
