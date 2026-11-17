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
 * 设置页题行动的落点：分区组件把页级动作（如技能的「安装」）portal 进标题行右端。
 *
 * 为什么用 portal 而不是把动作的 state 提到页面壳：动作依赖分区内部状态
 * （安装弹窗开关、当前 scope 等），提到壳上等于把域逻辑塞进页面；而按钮又必须
 * 出现在标题行——portal 让「位置」归壳、「内容与状态」归分区。槽位 flex 居中，
 * 按钮基线与标题文字自然对齐。
 *
 * 接口是「单对」（架构审查 W6，三件套收敛）：
 * - 壳侧只调 {@link useSettingsHeaderSlot}，拿到 `wrap`（包住标题行 + 分区内容）
 *   与 `host`（挂进标题行的落点），Provider 与落点不可能再配错顺序；
 * - 分区侧只用 {@link SettingsHeaderActions}。
 * 壳侧两处布局（PC 页题行 / 移动端头部右栏）各自调用一次，互不共享状态。
 *
 * 无宿主时（分区组件单独渲染 / 单测）就地渲染为右对齐行，不依赖页面壳也能出动作。
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styled from '@emotion/styled'

interface HeaderSlotValue {
    node: HTMLElement | null
    setNode: (node: HTMLElement | null) => void
}

const HeaderSlotContext = createContext<HeaderSlotValue | null>(null)

const HeaderSlotHost = styled.span`
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
`

const FallbackRow = styled.div`
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
`

export interface SettingsHeaderSlot {
    /** 包住「标题行 + 分区内容」的包装器（真实渲染 Context.Provider） */
    wrap: (children: ReactNode) => ReactNode
    /** 标题行右端的落点 element（挂进标题行 JSX） */
    host: ReactNode
}

/** 页面壳侧（唯一入口）：返回包装器与标题行落点，成对使用，不会漏配 */
export function useSettingsHeaderSlot(): SettingsHeaderSlot {
    const [node, setNode] = useState<HTMLElement | null>(null)
    const value = useMemo<HeaderSlotValue>(() => ({ node, setNode }), [node])
    // setNode 是 useState setter（引用恒定）；host 元素因此每次渲染重建也不抖动 ref
    const host = useMemo(() => <HeaderSlotHost ref={setNode} />, [setNode])
    const wrap = useCallback(
        (children: ReactNode) => <HeaderSlotContext.Provider value={value}>{children}</HeaderSlotContext.Provider>,
        [value],
    )
    return useMemo(() => ({ wrap, host }), [wrap, host])
}

/** 分区侧：动作内容（存在宿主则 portal 进标题行，否则就地右对齐渲染） */
export function SettingsHeaderActions({ children }: { children: ReactNode }) {
    const ctx = useContext(HeaderSlotContext)
    if (!ctx?.node) return <FallbackRow>{children}</FallbackRow>
    return createPortal(children, ctx.node)
}
