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

import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Bubble } from '@ant-design/x'
import { Skeleton } from 'antd'
import { BUBBLE_ROLES } from './bubbleRoles'
import type { BubbleItemBase } from './buildBubbleItems'

/** Virtuoso 渲染的 item 类型（decoratedItems 结构 + 装饰字段） */
export type ChatBubbleItem = BubbleItemBase & {
    header?: ReactNode
    footer?: ReactNode
    footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
    classNames?: { root?: string }
}

/**
 * 单个 bubble 渲染：复刻 antdx BubbleListItem 的 role 模板展开。
 *
 * Bubble.List 内部按 item.role 选 BUBBLE_ROLES 配置 + 选模板（divider/system/默认 Bubble），
 * 这里手动展开——把 role 配置直接传给 Bubble 单组件，保留视觉一致。
 */
const BubbleItem = memo(function BubbleItem({ item }: { item: ChatBubbleItem }) {
    const cfg = BUBBLE_ROLES[item.role as keyof typeof BUBBLE_ROLES] ?? {}
    // 拆出非 Bubble prop 字段
    const { key, role, block, header, footer, footerPlacement, classNames, content, typing, variant, ...rest } = item

    // divider：虚线分隔（context-cleared 等），用 antdx Bubble.Divider 对齐 Bubble.List 视觉
    if (role === 'divider') {
        return (
            <Bubble.Divider key={key} content={content} {...cfg} {...rest} />
        )
    }

    // system：无边框系统行（bg-task-completed 等），用 antdx Bubble.System
    if (role === 'system') {
        return (
            <Bubble.System key={key} content={content} {...cfg} {...rest} />
        )
    }

    return (
        <Bubble
            key={key}
            content={content}
            typing={typing}
            variant={variant}
            header={header}
            footer={footer}
            footerPlacement={footerPlacement}
            classNames={classNames}
            {...cfg}
            {...rest}
        />
    )
})

interface VirtuosoChatListProps {
    items: ChatBubbleItem[]
    /** 滚到顶部（更旧历史）时触发，对接 fetchNextPage */
    onStartReached?: () => void
    /** 贴底状态变化（驱动"滚到底"按钮等） */
    atBottomStateChange?: (atBottom: boolean) => void
    /** 是否正在加载更旧的历史页（为 true 时顶部渲染骨架） */
    isFetchingNextPage?: boolean
}

/**
 * 虚拟化聊天列表（PoC）—— 用 react-virtuoso 替换 Bubble.List。
 *
 * 只渲染视口附近的 bubble（increaseViewportBy 扩展上下缓冲），DOM 节点数钳制在 ~几十，
 * 不随消息总量增长。Virtuoso 自动测量动态高度（无需估高），followOutput 接管流式贴底跟随，
 * startReached 接管向上加载历史。
 */
export const VirtuosoChatList = forwardRef<VirtuosoHandle, VirtuosoChatListProps>(function VirtuosoChatList({ items, onStartReached, atBottomStateChange, isFetchingNextPage }, ref) {
    const handleStartReached = useCallback(() => {
        onStartReached?.()
    }, [onStartReached])

    // firstItemIndex：让 Virtuoso 识别"开头插入"（prepend 历史消息）vs"末尾追加"（流式新消息）。
    // Virtuoso 据此保持滚动位置（不会因 data 变化跳顶）。
    //
    // 实现：用 useState 存 firstItemIndex，useEffect 检测 items 开头 prepend 了 K 项
    // （prevFirstKey 在新 items 中的位置）后 setFirstItemIndex(prev => prev - K)。
    //
    // 为何不放 useMemo 工厂里（曾在 PoC 中这么做）：useMemo 工厂是 React 明确会重调以检测不纯
    // 的函数（StrictMode 双调用 / 并发渲染丢弃重试），在工厂里 `-=` 累减 + 改 ref 是不纯的
    // 渲染副作用，重调会让 index 偏差。移到 useEffect（提交后副作用）即符合 React 约定。
    //
    // 幂等性（StrictMode 双调用 effect）：第一次进入时 prevFirstKeyRef 更新为 firstKey，
    // cleanup（无）→ 第二次进入时 firstKey === prevFirstKeyRef.current 直接 return，不会重复减。
    // 详见 https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/#firstitemindex
    const [firstItemIndex, setFirstItemIndex] = useState(Number.MAX_SAFE_INTEGER)
    const prevFirstKeyRef = useRef<string | undefined>(undefined)
    useEffect(() => {
        const firstKey = items[0]?.key
        // 无变化（含 StrictMode 第二次进入）→ 跳过，保证幂等
        if (firstKey === prevFirstKeyRef.current) return
        if (prevFirstKeyRef.current !== undefined && firstKey !== undefined) {
            const idx = items.findIndex(it => it.key === prevFirstKeyRef.current)
            if (idx > 0) setFirstItemIndex(prev => prev - idx)
        }
        prevFirstKeyRef.current = firstKey
    }, [items])

    return (
        <Virtuoso
            ref={ref}
            data={items}
            firstItemIndex={firstItemIndex}
            // 初始滚到底部（最新消息）
            initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
            itemContent={(_index, item) => <BubbleItem item={item} />}
            // 顶部加载更旧历史时渲染骨架（替代旧 Bubble.List 的 __loading-skeleton__ 项）
            components={isFetchingNextPage ? {
                Header: () => (
                    <div style={{ padding: '12px 16px' }}>
                        <Skeleton avatar={{ shape: 'circle' }} paragraph={{ rows: 2 }} active />
                    </div>
                ),
            } : undefined}
            startReached={handleStartReached}
            // 流式追加时，若用户在底部则平滑跟随；离开底部则不自动滚（用户在看历史）
            followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
            atBottomStateChange={atBottomStateChange}
            // 视口外缓冲（类似 overscan），避免快速滚动时空白
            increaseViewportBy={{ top: 600, bottom: 600 }}
            style={{ height: '100%' }}
        />
    )
})
