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

import { memo, useCallback, type ReactNode } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Bubble } from '@ant-design/x'
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

    // divider：分隔线（context-cleared 等），简单渲染一条虚线
    if (role === 'divider') {
        return (
            <div className="ant-bubble ant-bubble-divider" style={{ alignSelf: 'center', margin: '8px 0' }}>
                {content}
            </div>
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
}

/**
 * 虚拟化聊天列表（PoC）—— 用 react-virtuoso 替换 Bubble.List。
 *
 * 只渲染视口附近的 bubble（increaseViewportBy 扩展上下缓冲），DOM 节点数钳制在 ~几十，
 * 不随消息总量增长。Virtuoso 自动测量动态高度（无需估高），followOutput 接管流式贴底跟随，
 * startReached 接管向上加载历史。
 */
export function VirtuosoChatList({ items, onStartReached, atBottomStateChange }: VirtuosoChatListProps) {
    const handleStartReached = useCallback(() => {
        onStartReached?.()
    }, [onStartReached])

    return (
        <Virtuoso
            data={items}
            // 初始滚到底部（最新消息）
            initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
            itemContent={(_index, item) => <BubbleItem item={item} />}
            startReached={handleStartReached}
            // 流式追加时，若用户在底部则平滑跟随；离开底部则不自动滚（用户在看历史）
            followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
            atBottomStateChange={atBottomStateChange}
            // 视口外缓冲（类似 overscan），避免快速滚动时空白
            increaseViewportBy={{ top: 600, bottom: 600 }}
            style={{ height: '100%' }}
        />
    )
}
