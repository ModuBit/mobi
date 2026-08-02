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

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
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

    // 合并顺序严格对齐 antdx BubbleList：`{ ...roleCfg, ...item }`，即 **item 覆盖 role 配置**
    //（见 @ant-design/x/es/bubble/BubbleList.js 的 mergedProps）。
    // 早前写成 `{...cfg}` 展开在 item 之后，role 配置反而覆盖 item，与 Bubble.List 行为相反——
    // 表现为 item.variant 对 assistant 恒被忽略。
    //
    // key / block 是本地字段，不能透传给 Bubble：
    // - key：React key 由 Virtuoso 的 computeItemKey 提供，这里是单个根元素，写 key 无效
    // - block：内部数据，非 Bubble prop
    const { key: _key, block: _block, role, ...itemProps } = item
    const merged = { ...cfg, ...itemProps }

    // divider：虚线分隔（context-cleared 等），用 antdx Bubble.Divider 对齐 Bubble.List 视觉
    if (role === 'divider') {
        return <Bubble.Divider {...merged} />
    }

    // system：无边框系统行（bg-task-completed 等），用 antdx Bubble.System
    if (role === 'system') {
        return <Bubble.System {...merged} />
    }

    return <Bubble {...merged} />
})

/** 传给 Virtuoso 的 context：Header 据此决定是否渲染历史加载骨架 */
type ChatListContext = { isFetchingNextPage: boolean }

/**
 * 顶部历史加载骨架（Virtuoso Header）。
 *
 * 必须是**模块级稳定组件**，不能在渲染期就地定义。若写成
 * `components={{ Header: () => isFetching ? <Skeleton/> : null }}`，
 * 每次 isFetching 变化都产生一个新的函数组件**类型**，React 会卸载旧子树、挂载新子树
 * 而非更新——曾表现为「Header 函数被调用但输出没进 DOM」（pending #39 的误判来源）。
 * 状态通过 Virtuoso 的 context prop 传入，组件类型恒定。
 */
const HistoryLoadingHeader = ({ context }: { context?: ChatListContext }) => (
    context?.isFetchingNextPage ? (
        <div style={{ padding: '12px 16px' }} data-testid="virtuoso-header">
            <Skeleton avatar={{ shape: 'circle' }} paragraph={{ rows: 2 }} active />
        </div>
    ) : null
)

/**
 * components 对象也提到模块级常量，保证引用恒定。
 *
 * 注意：components prop 必须始终传对象——传显式 undefined 会让 react-virtuoso 把
 * undefined 写入 components state，selector `d => d[l]` 对 undefined 读会崩
 *（Cannot read 'EmptyPlaceholder'，见 commit 8e5b02a）。
 */
const CHAT_LIST_COMPONENTS = { Header: HistoryLoadingHeader }

/**
 * firstItemIndex 的起始值。
 *
 * 必须远小于 `Number.MAX_SAFE_INTEGER`（2^53-1）：react-virtuoso 的 React key 默认由
 * `originalIndex + firstItemIndex` 算出，在 2^53 边界 float64 只能表示偶数，
 * 连续 index 会坍缩成同一个 key（9007199254740992 被 index 1 和 2 共用），
 * 造成 React key 大面积碰撞 → 消息重复渲染 + 尺寸测量错位 + 滚动定位错误。
 *
 * 本组件已显式传 computeItemKey（用稳定的 block id）规避 key 碰撞，
 * 但 firstItemIndex 仍参与 Virtuoso 内部的 index 算术，故一并留出安全余量。
 * 1e9 允许向上 prepend 十亿条历史，远超实际会话规模。
 */
const INITIAL_FIRST_ITEM_INDEX = 1_000_000_000

/**
 * 对外暴露的命令式 handle。
 * 自定义而非直接用 VirtuosoHandle：scrollToIndex 需在调用前重置 followRef
 *（用户点「滚到底」= 想恢复跟随，否则上次主动上滚后 followRef 仍为 false）。
 */
export interface VirtuosoChatListHandle {
    scrollToIndex: (opts: { index: number | 'LAST'; behavior?: 'auto' | 'smooth'; align?: 'start' | 'end' | 'center' }) => void
}

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
export const VirtuosoChatList = forwardRef<VirtuosoChatListHandle, VirtuosoChatListProps>(function VirtuosoChatList({ items, onStartReached, atBottomStateChange, isFetchingNextPage }, ref) {
    const handleStartReached = useCallback(() => {
        onStartReached?.()
    }, [onStartReached])

    // Virtuoso 的 context prop：把加载态传给 Header，而不是把状态闭包进 Header 函数。
    // 这样 Header 组件类型恒定，只有 context 值变化（见 HISTORY_LOADING_COMPONENTS 注释）。
    const context = useMemo(
        () => ({ isFetchingNextPage: !!isFetchingNextPage }),
        [isFetchingNextPage],
    )

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
    const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
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

    // 流式贴底跟随的补充机制。
    //
    // 为何必须补：Virtuoso 的 followOutput 只由 **totalCount 变化** 驱动
    //（dist/index.mjs 的 followOutput 管道监听 `W(totalCount)`）。但流式回复是把 token
    // 不断追加到**同一个** block —— item 数量不变，只是末项越来越高。于是整段流式期间
    // followOutput 一次都不触发，用户停在原位看不到新内容（实测长回复偏离底部 1900px+）。
    //
    // 做法：用 ResizeObserver 观测内容总高，增长时若用户在底部则直接钉到底。
    //
    // 为何直接改 scrollTop 而非 scrollToIndex：scrollToIndex 走 Virtuoso 内部管道
    //（偏移树查找 + atBottom 状态机），在内容**持续**增长时跟不上——每次跳完内容又长，
    // 状态机滞后，偏离累积（实测 scrollToIndex 'auto' 仍偏离 600px+）。直接设 scrollTop
    // 瞬即到底，并用「实际几何位置」判断是否在底部，不依赖 Virtuoso 状态机。
    const virtuosoRef = useRef<VirtuosoHandle | null>(null)
    const scrollerElRef = useRef<HTMLElement | null>(null)
    const observerRef = useRef<ResizeObserver | null>(null)
    // 用户是否「想贴底跟随」。用户主动上滚（滚轮/触摸）→ false；点「滚到底」→ true。
    // 不用 atBottomStateChange（distance>4px 就翻 false，流式一增长就掉队），
    // 也不用 distance 阈值（一旦临时偏离超阈值就永久掉队）。
    // wheel/touchmove 只由真实用户手势触发，程序改 scrollTop 不触发，是「主动上滚」最干净的信号。
    const followRef = useRef(true)
    // programmatic smooth 滚动进行中标志。smooth 期间沿途 item 被虚拟化逐个测量，
    // 估算高度→实际高度，item-list 总高累积增长，会误触发 ResizeObserver 瞬跳，
    // 打断 smooth 最后阶段（表现为「最后突然跳一下」）。scrollend 后解除。
    const smoothScrollingRef = useRef(false)

    const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
        scrollerElRef.current = el && !(el instanceof Window) ? el : null
    }, [])

    // 用户主动上滚 → 停止跟随；用户没主动操作 → 流式始终贴底
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!scroller) return
        const stop = () => { followRef.current = false }
        const onScrollEnd = () => { smoothScrollingRef.current = false }
        scroller.addEventListener('wheel', stop, { passive: true })
        scroller.addEventListener('touchmove', stop, { passive: true })
        scroller.addEventListener('scrollend', onScrollEnd, { passive: true })
        return () => {
            scroller.removeEventListener('wheel', stop)
            scroller.removeEventListener('touchmove', stop)
            scroller.removeEventListener('scrollend', onScrollEnd)
        }
    }, [items.length > 0])

    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!scroller) return

        // 观测 item-list（内容总高所在层）。不能观测 scroller.firstElementChild——
        // 那是 Virtuoso 的视口层，高度恒等于 clientHeight，内容增长时不变，观测它永不触发。
        const content = scroller.querySelector('[data-testid="virtuoso-item-list"]')
        if (!content) return

        const observer = new ResizeObserver(() => {
            if (!followRef.current) return
            if (smoothScrollingRef.current) return // smooth 动画进行中，不抢断
            scroller.scrollTop = scroller.scrollHeight
        })
        observer.observe(content)
        observerRef.current = observer
        return () => {
            observer.disconnect()
            observerRef.current = null
        }
        // items.length 由 0 变正时 item-list 才挂载，需重建观测
    }, [items.length > 0])

    // atBottomStateChange 转发给 ChatContainer，驱动「滚到底」按钮显隐
    const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
        atBottomStateChange?.(atBottom)
    }, [atBottomStateChange])

    // 对外暴露 scrollToIndex，调用前重置 followRef（用户点「滚到底」= 想恢复跟随）。
    // smooth 滚动时置 smoothScrollingRef，让 ResizeObserver 期间不抢断（见上方注释）。
    useImperativeHandle(ref, (): VirtuosoChatListHandle => ({
        scrollToIndex: (opts) => {
            followRef.current = true
            if (opts.behavior === 'smooth') smoothScrollingRef.current = true
            virtuosoRef.current?.scrollToIndex(opts)
        },
    }), [])

    // React key 用 item 自身稳定的 key（= block.id），不用 Virtuoso 默认的 index 算术。
    // 默认 computeItemKey 是恒等函数，key = originalIndex + firstItemIndex，既受浮点精度影响，
    // 又会在 prepend 时让同一条消息换 key（整列表重挂载）。用 block.id 后 key 与位置解耦。
    const computeItemKey = useCallback(
        (_index: number, item: ChatBubbleItem) => item.key,
        [],
    )

    // itemContent 保持稳定引用：内联箭头函数每次渲染都是新引用，会让 Virtuoso
    // 对所有可见项重新调用渲染，抵消 BubbleItem 的 memo
    const itemContent = useCallback(
        (_index: number, item: ChatBubbleItem) => <BubbleItem item={item} />,
        [],
    )

    return (
        <Virtuoso
            ref={virtuosoRef}
            data={items}
            firstItemIndex={firstItemIndex}
            computeItemKey={computeItemKey}
            // 初始滚到底部（最新消息）
            initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
            itemContent={itemContent}
            // 顶部加载更旧历史时渲染骨架（替代旧 Bubble.List 的 __loading-skeleton__ 项）。
            // 组件类型与对象引用均为模块级常量，加载态经 context 传入（见 HistoryLoadingHeader）
            components={CHAT_LIST_COMPONENTS}
            context={context}
            startReached={handleStartReached}
            // 流式追加时，若用户在底部则平滑跟随；离开底部则不自动滚（用户在看历史）
            followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
            atBottomStateChange={handleAtBottomStateChange}
            // 视口外缓冲（类似 overscan），避免快速滚动时空白
            increaseViewportBy={{ top: 600, bottom: 600 }}
            // 拿到滚动容器，供 ResizeObserver 观测内容高度变化（流式贴底跟随）
            scrollerRef={handleScrollerRef}
            style={{ height: '100%' }}
        />
    )
})
