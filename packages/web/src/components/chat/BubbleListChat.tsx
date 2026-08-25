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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bubble } from '@ant-design/x'
import { Skeleton } from 'antd'
import { BUBBLE_ROLES } from './bubbleRoles'
import type { BubbleItemBase } from './buildBubbleItems'
import { useStickToBottom } from './useStickToBottom'
import { VISIBLE_WINDOW, EXPAND_WINDOW } from '@/core/data/stores/messageWindowStore'

/** 装饰后的 bubble item 类型（buildBubbleItems 产出 + header/footer/装饰字段） */
export type ChatBubbleItem = BubbleItemBase & {
    header?: ReactNode
    footer?: ReactNode
    footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
    classNames?: { root?: string }
}

/** 对外暴露的命令式 handle（与 VirtuosoChatList 同接口，ChatContainer 无感切换） */
export interface BubbleListChatHandle {
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void
}

interface BubbleListChatProps {
    items: ChatBubbleItem[]
    /** 是否还有更旧的历史页（驱动「滚到顶加载」与 fill 级联） */
    hasNextPage: boolean
    /** 正在加载更旧的历史页（顶部渲染 skeleton，fill 级联期间不显示） */
    isFetchingNextPage: boolean
    /** 加载更旧历史（对接 fetchNextPage） */
    onLoadMore: () => void
    /** 跟随状态变化：false 表示用户在看历史，驱动「滚到底」按钮显隐 */
    onFollowingChange?: (following: boolean) => void
}

/** 滚到顶部多少像素内触发历史加载 */
const HISTORY_PREFETCH_DISTANCE = 200
/** prepend 历史后 scrollTop 补偿期间，屏蔽 scroll 事件的时间窗（覆盖 RO + rAF 双帧延迟） */
const RESTORE_SCROLL_GUARD_MS = 100

/**
 * fill 级联判据：内容是否未撑满视口（几何语义）。
 *
 * fill 的设计语义是「初始加载内容未溢出时连续拉页」——补的是**视口**，不是消息数：
 * 启动条件必须与停止条件（scrollHeight > clientHeight 停，见 fill effect）对称，都按几何判定。
 * 严禁用「renderItems < VISIBLE_WINDOW」之类数量条件做启动判据——bubble 与消息不是 1:1
 * （tool-heavy 会话 ~6 消息/bubble），数量启动 + 几何停止的不对称会形成循环拉取，
 * 直到凑够 400 bubble（实测 28 请求 / 82% 会话历史；更低的 bubble 比则全量加载）。
 * clientHeight=0（容器隐藏/未布局）不触发，避免隐藏态误拉。
 */
function isViewportUnfilled(scrollBox: HTMLElement): boolean {
    return scrollBox.clientHeight > 0 && scrollBox.scrollHeight <= scrollBox.clientHeight
}

/**
 * 全量渲染的聊天列表（antdx Bubble.List）。
 *
 * ## 为什么不用 react-virtuoso
 *
 * 虚拟化路径（react-virtuoso）已废弃——估高→RO 实测异步修正导致 prepend 后上滚跳动，
 * 且 maxHeight 组件 / group 折叠态 / 代码块·工具卡的高度与字符数无关，估高启发式无解。
 * 全量渲染无估高、无测量修正、无跳动；代价是 DOM 随消息量增长，由第二步「数据层窗口化」钳制。
 * 虚拟化代码留存于 tag `chat-list-virtualized`，踩坑记录见 memory（virtuoso-* 系列）。
 *
 * ## 贴底跟随
 *
 * 复用 useStickToBottom（虚拟化期间修好的产物：手势 stop / 几何 re-follow 延时 /
 * smooth 门闩 / pointerDown 守卫）。Bubble.List 的 scroller 是 scrollBoxNativeElement，
 * 内容层是 `.ant-bubble-list-scroll-content`，useStickToBottom 据此观测 + pin。
 *
 * ## prepend 历史维持 scrollTop
 *
 * Bubble.List 无 virtuoso 的 firstItemIndex 机制——手动 pin：prepend 前记 scrollHeight，
 * items 变化后 useLayoutEffect 在 DOM 提交后 `scrollTop += (newH - oldH)` 维持视口。
 * 全量在 DOM、real heights 同步可读，手动 pin 可行（虚拟化下不可行正是当初放弃的原因）。
 *
 * `autoScroll={false}`：禁用 antdx 内置 autoScroll（它用 column-reverse + enforceScrollLock
 * 独立管理视口，与手动 restore 时序冲突），改由 useStickToBottom + 本组件自管。
 */
export const BubbleListChat = forwardRef<BubbleListChatHandle, BubbleListChatProps>(function BubbleListChat(
    { items, hasNextPage, isFetchingNextPage, onLoadMore, onFollowingChange },
    ref,
) {
    // 外层容器 ref：用 querySelector 找 Bubble.List 内部 scrollBox，不依赖 BubbleListRef.scrollBoxNativeElement
    //（后者在 antx 内部 effect 后才赋值，晚于本组件 useLayoutEffect，会读 null）
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const scrollBoxRef = useRef<HTMLDivElement | null>(null)
    // prepend 历史时记录的 scroll 几何，供 restore useLayoutEffect 维持视口
    // firstItemKey：原首项 key（N=800 prepend+append 裁时用 offsetTop 测量补偿量）
    const pendingRestoreRef = useRef<{ scrollTop: number; scrollHeight: number; itemsLength: number; firstItemKey?: string | number | null } | null>(null)
    // restore 补偿期间屏蔽 scroll listener（避免重复触发 prefetch / 误判 fill）
    const isRestoringScrollRef = useRef(false)
    // fill 级联：初始加载内容未溢出时连续拉页，期间不显示 skeleton（避免高度来回跳动）
    const isFillingRef = useRef(false)
    const scrollRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // 把最新 props 同步到 ref，让 scroll listener / effect 闭包读到最新值而不重建
    const itemsLengthRef = useRef(items.length)
    itemsLengthRef.current = items.length
    const hasNextPageRef = useRef(hasNextPage)
    hasNextPageRef.current = hasNextPage
    const isFetchingNextPageRef = useRef(isFetchingNextPage)
    isFetchingNextPageRef.current = isFetchingNextPage
    const onLoadMoreRef = useRef(onLoadMore)
    onLoadMoreRef.current = onLoadMore

    // window 状态机：贴末尾模式（含最新）vs 滑动模式（老位置，不含最新）。
    // following=true → 贴末尾 slice(-VISIBLE_WINDOW)；following=false → slice(-N) 动态增长到 EXPAND_WINDOW。
    // null = 贴末尾模式；数字 = 滑动模式 start（用户上滚到 N=800 后继续上滚，start 偏移，不含最新）
    const windowStartRef = useRef<number | null>(null)
    // 贴末尾模式动态 N（上滚 prepend 增长，cap EXPAND_WINDOW）
    const windowSizeRef = useRef(VISIBLE_WINDOW)
    // window ref 变更不触发 re-render，用 windowTick 显式触发（window prepend / 滑动模式切换后 +1）
    const [windowTick, setWindowTick] = useState(0)

    // 同步 renderItems 信息到 ref（handleScroll useCallback([]) 闭包读不到 renderItems）
    const firstRenderItemKeyRef = useRef<string | number | null | undefined>(undefined)

    const { handleScrollerRef, following, stickToBottom } = useStickToBottom(items.length > 0)
    // following 同步到 ref：fill 块/effect 闭包读最新值（防 fill 级联钉底瞬移上滚看历史的用户）
    const followingRef = useRef(following)
    followingRef.current = following

    // Bubble.List 挂载后拿 scrollBoxNativeElement 交给 useStickToBottom 观测 / pin。
    // useLayoutEffect 先于 useStickToBottom 的 useEffect（RO observe）跑，故 scroller 已就位。
    useLayoutEffect(() => {
        const scrollBox = scrollContainerRef.current?.querySelector('.ant-bubble-list-scroll-box') as HTMLDivElement | null
        if (!scrollBox) return
        scrollBoxRef.current = scrollBox
        handleScrollerRef(scrollBox)
    }, [items.length > 0, handleScrollerRef])

    // 跟随状态上抛，驱动「滚到底」按钮；following=true 时重置 window 到贴末尾模式
    useEffect(() => {
        if (following) {
            // 点按钮/滚回底部：重置贴末尾模式
            windowStartRef.current = null
            windowSizeRef.current = VISIBLE_WINDOW
        }
        onFollowingChange?.(following)
    }, [following, onFollowingChange])

    // 首次有消息时滚到底部（最新消息）
    const initialScrollRef = useRef(true)
    useLayoutEffect(() => {
        if (initialScrollRef.current && items.length > 0 && scrollBoxRef.current) {
            initialScrollRef.current = false
            scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight
        }
    }, [items.length])

    // scroll listener：滚到顶 prefetch 历史 + 视口变化 fill 检测。
    // 贴底跟随由 useStickToBottom 独占，此处只管「向上加载」相关，不与 useStickToBottom 争抢 scrollTop。
    const handleScroll = useCallback(() => {
        if (isRestoringScrollRef.current) return
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        const { scrollTop, scrollHeight } = scrollBox

        // 滚到顶 prefetch：window 滑动 + 滑动模式置位 + store 顶 fetchNextPage
        if (scrollTop < HISTORY_PREFETCH_DISTANCE && !isFetchingNextPageRef.current) {
            const inSlidingMode = windowStartRef.current !== null
            const inTailMode = !inSlidingMode
            // store 中是否还有比当前 window 更旧的 item
            const windowHasOlderInStore = inSlidingMode
                ? windowStartRef.current! > 0
                : itemsLengthRef.current > windowSizeRef.current

            if (inTailMode && windowSizeRef.current >= EXPAND_WINDOW && windowHasOlderInStore) {
                // 贴末尾 N=800 + store 还有更旧 → 转滑动模式（DOM 不变，后续上滚走滑动 prepend）
                pendingRestoreRef.current = {
                    scrollTop, scrollHeight,
                    itemsLength: itemsLengthRef.current,
                    firstItemKey: firstRenderItemKeyRef.current,
                }
                windowStartRef.current = itemsLengthRef.current - EXPAND_WINDOW
                setWindowTick(v => v + 1)
                return
            }
            if (windowHasOlderInStore) {
                // store 已有更旧：window prepend（不 fetch，仅扩窗口）
                pendingRestoreRef.current = {
                    scrollTop, scrollHeight,
                    itemsLength: itemsLengthRef.current,
                    firstItemKey: firstRenderItemKeyRef.current,
                }
                if (inSlidingMode) {
                    // 滑动模式：start 前移 50（prepend + append 裁）
                    windowStartRef.current = Math.max(0, windowStartRef.current! - 50)
                } else {
                    // 贴末尾模式：N 增长 50（只 prepend 不裁，cap 800）
                    windowSizeRef.current = Math.min(windowSizeRef.current + 50, EXPAND_WINDOW)
                }
                setWindowTick(v => v + 1)
                return
            }
            // store 全量也到顶：fetchNextPage（拉新页扩展 store）
            if (hasNextPageRef.current) {
                pendingRestoreRef.current = {
                    scrollTop, scrollHeight,
                    itemsLength: itemsLengthRef.current,
                    firstItemKey: firstRenderItemKeyRef.current,
                }
                onLoadMoreRef.current()
            }
            return
        }

        // fill：内容未撑满视口 + 还有历史 + 仍在贴底（following） → 主动加载。
        // 判据见 isViewportUnfilled（几何语义，与停止条件对称）；
        // gate following：用户上滚看历史（following=false）时不 fill，避免 fill effect 钉底瞬移用户
        if (isViewportUnfilled(scrollBox) && hasNextPageRef.current && !isFetchingNextPageRef.current && followingRef.current) {
            isFillingRef.current = true
            onLoadMoreRef.current()
        }
    }, [])

    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        scrollBox.addEventListener('scroll', handleScroll, { passive: true })
        // 挂载即检查 overflow（初始内容未溢出时启动 fill）
        handleScroll()
        return () => scrollBox.removeEventListener('scroll', handleScroll)
    }, [handleScroll])

    // prepend 历史维持 scrollTop：items 变化后 DOM 已提交，此时读新 scrollHeight，
    // 按 delta 补偿 scrollTop。全量在 DOM，real heights 同步可读，无需等 RO 测量。
    // N=800（prepend + append 裁同时）时 scrollHeight delta 不精确，改用原首项 offsetTop 测量。
    useLayoutEffect(() => {
        const pending = pendingRestoreRef.current
        if (!pending) return
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return

        // 判断补偿方式：N=800（滑动模式 / 贴末尾 N 已 cap）用 offsetTop，N<800 用 scrollHeight delta
        const inSlidingOrCapped = windowStartRef.current !== null || windowSizeRef.current >= EXPAND_WINDOW
        let compensate: number | null = null

        if (inSlidingOrCapped && pending.firstItemKey != null) {
            // N=800：原首项从 offsetTop=0 变到 offsetTop=prependHeight（顶部加了新 item）
            // 用 querySelectorAll + dataset 匹配，避免 CSS 选择器转义问题
            const firstEl = Array.from(scrollBox.querySelectorAll('[data-bubble-key]'))
                .find(el => (el as HTMLElement).dataset.bubbleKey === String(pending.firstItemKey)) as HTMLElement | undefined
            if (firstEl) {
                compensate = firstEl.offsetTop
            }
        }
        if (compensate == null) {
            // N<800（只 prepend 不裁）或 offsetTop 测量失败：scrollHeight delta（精确）
            compensate = scrollBox.scrollHeight - pending.scrollHeight
        }

        if (compensate !== 0) {
            isRestoringScrollRef.current = true
            scrollBox.scrollTop = pending.scrollTop + compensate
            pending.scrollTop = scrollBox.scrollTop
            pending.scrollHeight = scrollBox.scrollHeight
        }
        // 加载完成（items 增长 / fetch 结束 / window prepend）→ 清 pending，延时解除 restore guard。
        // 延时内若仍在顶部附近 → 自动续拉下一页（修复「restore 后无 scroll 事件、用户须再滚一下」）
        if (items.length > pending.itemsLength || !isFetchingNextPageRef.current) {
            const restoredScrollTop = scrollBox.scrollTop
            pendingRestoreRef.current = null
            isRestoringScrollRef.current = true
            if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
            scrollRestoreTimerRef.current = setTimeout(() => {
                scrollRestoreTimerRef.current = null
                isRestoringScrollRef.current = false
                // restore 后若仍在顶部附近，继续触发（window prepend 或 fetchNextPage）
                if (restoredScrollTop < HISTORY_PREFETCH_DISTANCE) {
                    handleScroll()
                }
            }, RESTORE_SCROLL_GUARD_MS)
        }
    }, [items.length, isFetchingNextPage, windowTick, handleScroll])

    // fill 级联：内容溢出后停 fill + 钉底；未溢出且仍有历史则继续拉。
    useEffect(() => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        // rewind 截断后内容不足视口：主动启动 fill 补足（清除行不产生 scroll 事件，
        // startReached 路径不会自然触发；判据与 handleScroll 的 fill 分支一致，见 isViewportUnfilled）
        if (!isFillingRef.current
            && isViewportUnfilled(scrollBox)
            && hasNextPageRef.current && !isFetchingNextPageRef.current && followingRef.current) {
            isFillingRef.current = true
            onLoadMoreRef.current()
            return
        }
        if (!isFillingRef.current) return
        if (!hasNextPageRef.current || isFetchingNextPageRef.current) return
        const { scrollHeight, clientHeight } = scrollBox
        if (scrollHeight <= clientHeight) {
            onLoadMoreRef.current()
        } else {
            // 停 fill；仅仍在贴底时钉底（防竞态：fill 进行中用户上滚后不应被瞬移回底）
            isFillingRef.current = false
            if (followingRef.current) scrollBox.scrollTop = scrollBox.scrollHeight
        }
    }, [items.length, isFetchingNextPage])

    // 卸载清孤儿定时器
    useEffect(() => () => {
        if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
    }, [])

    useImperativeHandle(ref, (): BubbleListChatHandle => ({
        scrollToBottom: stickToBottom,
    }), [stickToBottom])

    // renderItems：window slice + 顶部 skeleton。
    //
    // window 状态机（spec §6.2）：
    // - following=true（贴底看最新）：items.slice(-VISIBLE_WINDOW=400)，SSE 增长裁顶保 400
    // - following=false + 贴末尾模式（N<800）：items.slice(-N)，N 动态增长（上滚 prepend 增，cap 800）
    // - following=false + 滑动模式（N=800 后继续上滚）：items.slice(start, start+800)，不含最新
    //
    // data-bubble-key 由上游 reconcileBubbleItems 在复用/新建时挂上（不在本层 spread，
    // 以免给 400-800 个 windowed item 造新对象击穿 reconcileBubbleItems 的结构化共享）。
    const renderItems = useMemo<ChatBubbleItem[]>(() => {
        let windowed: ChatBubbleItem[]
        if (following) {
            // 贴末尾：最新 VISIBLE_WINDOW
            windowStartRef.current = null
            windowSizeRef.current = VISIBLE_WINDOW
            windowed = items.slice(-VISIBLE_WINDOW)
        } else if (windowStartRef.current !== null) {
            // 滑动模式：固定 start + EXPAND_WINDOW（不含最新）
            const start = windowStartRef.current
            windowed = items.slice(start, start + EXPAND_WINDOW)
        } else {
            // 贴末尾模式 + following=false：动态 N（上滚 prepend 增长，cap EXPAND_WINDOW）
            const n = Math.min(windowSizeRef.current, EXPAND_WINDOW)
            windowed = items.slice(-n)
        }
        // 顶部 skeleton：fill 级联期间不显示（高度来回跳动致抖动），仅用户主动滚到顶加载时显示
        if (!isFetchingNextPage || isFillingRef.current) return windowed
        return [
            {
                key: '__loading-skeleton__',
                role: 'system' as const,
                content: <Skeleton active avatar paragraph={{ rows: 2 }} />,
            },
            ...windowed,
        ]
    }, [items, following, isFetchingNextPage, windowTick])

    // 跳过 skeleton，取第一个真实 item 的 key（供 offsetTop querySelector 测量）
    const firstRealItem = renderItems.find(it => it.key !== '__loading-skeleton__')
    firstRenderItemKeyRef.current = firstRealItem?.key

    return (
        <div ref={scrollContainerRef} style={{ height: '100%' }}>
            <Bubble.List
                items={renderItems}
                role={BUBBLE_ROLES}
                autoScroll={false}
                style={{ height: '100%' }}
            />
        </div>
    )
})
