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
 * 设置页题行动的落点：页面壳在分区标题同一行右侧预留一个 span，分区组件
 * （懒加载的 Outlet 子树）把页级动作（如技能的「安装」）portal 进去。
 *
 * 为什么用 portal 而不是把动作的 state 提到页面壳：动作依赖分区内部状态
 * （安装弹窗开关、当前 scope 等），提到壳上等于把域逻辑塞进页面；而按钮又必须
 * 出现在标题行——portal 让「位置」归壳、「内容与状态」归分区。槽位 flex 居中，
 * 按钮基线与标题文字自然对齐。
 *
 * 无宿主时（分区组件单独渲染 / 单测 / 移动端头部无落点）就地渲染为右对齐行，
 * 不依赖页面壳也能出动作。
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

/** 页面壳侧：在标题行内包住 title 与落点所在的子树 */
export function SettingsHeaderSlotProvider({ children }: { children: ReactNode }) {
    const [node, setNode] = useState<HTMLElement | null>(null)
    const value = useMemo<HeaderSlotValue>(() => ({ node, setNode }), [node])
    return <HeaderSlotContext.Provider value={value}>{children}</HeaderSlotContext.Provider>
}

/** 页面壳侧：标题行右端的落点本体 */
export function SettingsHeaderSlotHostSlot() {
    const ctx = useContext(HeaderSlotContext)
    // setNode 取自 useState（引用恒定）；ref 只依赖它，避免每次渲染 detach/attach 抖动
    const setNode = ctx?.setNode
    const ref = useCallback((element: HTMLElement | null) => {
        setNode?.(element)
    }, [setNode])
    return <HeaderSlotHost ref={ref} />
}

/** 分区侧：动作内容（存在宿主则 portal 进标题行，否则就地右对齐渲染） */
export function SettingsHeaderActions({ children }: { children: ReactNode }) {
    const ctx = useContext(HeaderSlotContext)
    if (!ctx?.node) return <FallbackRow>{children}</FallbackRow>
    return createPortal(children, ctx.node)
}
