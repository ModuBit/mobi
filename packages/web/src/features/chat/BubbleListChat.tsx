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
import { BUBBLE_ROLES } from '@/ui/base/display/bubbleRoles'
import type { BubbleItemBase } from './buildBubbleItems'
import { HistoryLoadingRow } from './ChatMessagesSkeleton'
import { useStickToBottom } from './useStickToBottom'
import { VISIBLE_WINDOW, EXPAND_WINDOW } from '@/core/data/stores/messageWindowStore'

/** 装饰后的 bubble item 类型（buildBubbleItems 产出 + header/footer/装饰字段） */
export type ChatBubbleItem = BubbleItemBase & {
    header?: ReactNode
    footer?: ReactNode
    footerPlacement?: 'inner-start' | 'inner-end' | 'outer-start' | 'outer-end'
}

/** 对外暴露的命令式 handle（与 VirtuosoChatList 同接口，ChatContainer 无感切换） */
export interface BubbleListChatHandle {
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void
    /** 停止贴底跟随（引用定位跳转前调用，防流式钉底与跳转争抢 scrollTop） */
    stopFollow: () => void
}

interface BubbleListChatProps {
    items: ChatBubbleItem[]
    /** 是否还有更旧的历史页（驱动「滚到顶加载」与 fill 级联） */
    hasNextPage: boolean
    /** 正在加载更旧的历史页（顶部渲染历史加载行，fill 级联期间不显示） */
    isFetchingNextPage: boolean
    /** 首页历史仍在拉取（SSE 先到的内容已可看）：顶部渲染历史加载行 */
    historyLoading?: boolean
    /** 加载更旧历史（对接 fetchNextPage） */
    onLoadMore: () => void
    /** 跟随状态变化：false 表示用户在看历史，驱动「滚到底」按钮显隐 */
    onFollowingChange?: (following: boolean) => void
}

/** 滚到顶部多少像素内触发历史加载 */
const HISTORY_PREFETCH_DISTANCE = 200
/** prepend 历史后 scrollTop 补偿期间，屏蔽 scroll 事件的时间窗（覆盖 RO + rAF 双帧延迟） */
const RESTORE_SCROLL_GUARD_MS = 100

/** prepend 补偿的锚点样本：key + 捕获时的 rect.top（视口坐标） */
interface AnchorSample {
    key: string
    top: number
}

/** 快照最多记几个视口内锚点（覆盖视口内可见项，个别灭失时退让下一个） */
const MAX_ANCHORS = 8

/**
 * 视口锚点快照：每次 items 变化后的 layout effect 里重拍，下一次内容变化时按同一批
 * key 的 rect.top 残差补偿 scrollTop。
 *
 * 为什么锚点取「视口内全部可见项」而不只第一个：prepend / 窗口裁切 / React 复用都可能
 * 让个别 bubble 从 DOM 消失，单个锚点灭掉就只能退回末尾渲染项——而末尾项常在视口外，
 * 它的位移不等于视口位移（浏览器原生 anchoring 只保证视口内节点不动），拿它补偿会把
 * 视口推偏（2026-11-17 实测一次 1639px 的错误补偿，表现为「加载完成后内容被上移」）。
 *
 * 补偿以「锚点的视口位置不动」为准，而不是 scrollHeight delta——delta 会把加载期间
 * 无关的高度变化（相邻 bubble 延迟排版、图片/代码高亮加载、折叠测量）也算进补偿量，
 * 并且会和浏览器原生 scroll anchoring 的自动补偿重复叠加。
 */
interface AnchorSnapshot {
    anchors: AnchorSample[]
    /** 末尾渲染项：仅作无原生 anchoring（Safari）时的兜底，视口外位移不可靠 */
    tail: AnchorSample | null
    scrollTop: number
    scrollHeight: number
}

/** 按 data-bubble-key 找已渲染的真实项（顶部加载行没有该属性，天然跳过） */
function findBubbleEl(scrollBox: HTMLElement, key: string): HTMLElement | undefined {
    return Array.from(scrollBox.querySelectorAll<HTMLElement>('[data-bubble-key]'))
        .find(el => el.dataset.bubbleKey === key)
}

/** 捕获视口锚点快照：视口内可见项（按视口顺序，最多 MAX_ANCHORS 个）+ 末尾渲染项 */
function captureAnchors(scrollBox: HTMLElement): AnchorSnapshot {
    const snapshot: AnchorSnapshot = {
        anchors: [],
        tail: null,
        scrollTop: scrollBox.scrollTop,
        scrollHeight: scrollBox.scrollHeight,
    }
    const els = Array.from(scrollBox.querySelectorAll<HTMLElement>('[data-bubble-key]'))
    if (els.length === 0) return snapshot
    const boxTop = scrollBox.getBoundingClientRect().top
    const boxBottom = boxTop + scrollBox.clientHeight
    for (const el of els) {
        const key = el.dataset.bubbleKey
        if (!key) continue
        const rect = el.getBoundingClientRect()
        if (rect.bottom > boxTop + 1 && rect.top < boxBottom - 1) {
            snapshot.anchors.push({ key, top: rect.top })
            if (snapshot.anchors.length >= MAX_ANCHORS) break
        }
    }
    const tailEl = els[els.length - 1]
    if (tailEl?.dataset.bubbleKey && !snapshot.anchors.some(a => a.key === tailEl.dataset.bubbleKey)) {
        snapshot.tail = { key: tailEl.dataset.bubbleKey, top: tailEl.getBoundingClientRect().top }
    }
    return snapshot
}

/** 浏览器是否实现原生 scroll anchoring（Chrome / Firefox true，Safari false） */
function supportsScrollAnchoring(): boolean {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('overflow-anchor', 'auto')
}

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
 * ## prepend 历史维持视口
 *
 * Bubble.List 无 virtuoso 的 firstItemIndex 机制——手动 pin：每次内容变化后拍下「视口内
 * 可见项」的 rect.top 快照，下一次变化时按同一批锚点的视口位移残差补偿 scrollTop
 *（items 变化走 layout effect，内容层高度变化走 ResizeObserver）。锚点法对无关高度变化与
 * 浏览器 scroll anchoring 的自动补偿都免疫（详见 reconcileAnchors 注释）。全量在 DOM、
 * real heights 同步可读，手动 pin 可行。fill 补页完成后也不再钉底（钉底会把正在看的
 * 内容瞬移到最新处）；初始历史到位同理——历史在上方 prepend，保持用户视线。
 *
 * `autoScroll={false}`：禁用 antdx 内置 autoScroll（它用 column-reverse + enforceScrollLock
 * 独立管理视口，与手动 restore 时序冲突），改由 useStickToBottom + 本组件自管。
 */
export const BubbleListChat = forwardRef<BubbleListChatHandle, BubbleListChatProps>(function BubbleListChat(
    { items, hasNextPage, isFetchingNextPage, historyLoading = false, onLoadMore, onFollowingChange },
    ref,
) {
    // 外层容器 ref：用 querySelector 找 Bubble.List 内部 scrollBox，不依赖 BubbleListRef.scrollBoxNativeElement
    //（后者在 antx 内部 effect 后才赋值，晚于本组件 useLayoutEffect，会读 null）
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const scrollBoxRef = useRef<HTMLDivElement | null>(null)
    // 视口锚点快照：每次 items 变化的 layout effect 里重拍，下次内容变化时量残差补偿
    const anchorSnapshotRef = useRef<AnchorSnapshot | null>(null)
    // restore 补偿期间屏蔽 scroll listener（避免重复触发 prefetch / 误判 fill）
    const isRestoringScrollRef = useRef(false)
    // fill 级联：初始加载内容未溢出时连续拉页，期间不显示 loading（避免高度来回跳动）
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

    const { handleScrollerRef, following, stickToBottom, stopFollow } = useStickToBottom(items.length > 0)
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
        const { scrollTop } = scrollBox

        // 用户滚动 → O(1) 平移快照锚点：内容未变时锚点的视口 top 随 scrollTop 精确平移，
        // 这样「加载前用户滚过一段」不会混进下一次的残差里。
        // 只在 scrollHeight 未变（内容没动）时平移：内容变化引发的 st 调整（浏览器原生
        // anchoring / 钉底）同时改变了锚点位置，此时平移会把已施加的补偿二次计入残差
        //（实测表现为补偿一倍：56px 增高被补成 112px 位移）。
        const snapshot = anchorSnapshotRef.current
        if (snapshot && scrollBox.scrollHeight === snapshot.scrollHeight) {
            const drift = scrollTop - snapshot.scrollTop
            if (drift !== 0) {
                for (const anchor of snapshot.anchors) anchor.top -= drift
                if (snapshot.tail) snapshot.tail.top -= drift
                snapshot.scrollTop = scrollTop
            }
        }

        // 滚到顶 prefetch：window 滑动 + 滑动模式置位 + store 顶 fetchNextPage
        if (scrollTop < HISTORY_PREFETCH_DISTANCE && !isFetchingNextPageRef.current) {
            // 即将触发加载：以此刻的视口重拍锚点快照——补偿基准必须是「用户此刻看到的内容」。
            // 依赖滚动平移的旧快照会在滚动后只剩视口外锚点，而视口外节点的位移不等于视口
            // 位移（窗口裁切/懒加载/重排都会干扰），拿它补偿会把视口推偏（实测 1520px）。
            anchorSnapshotRef.current = captureAnchors(scrollBox)
            const inSlidingMode = windowStartRef.current !== null
            const inTailMode = !inSlidingMode
            // store 中是否还有比当前 window 更旧的 item
            const windowHasOlderInStore = inSlidingMode
                ? windowStartRef.current! > 0
                : itemsLengthRef.current > windowSizeRef.current

            if (inTailMode && windowSizeRef.current >= EXPAND_WINDOW && windowHasOlderInStore) {
                // 贴末尾 N=800 + store 还有更旧 → 转滑动模式（DOM 不变，后续上滚走滑动 prepend）
                windowStartRef.current = itemsLengthRef.current - EXPAND_WINDOW
                setWindowTick(v => v + 1)
                return
            }
            if (windowHasOlderInStore) {
                // store 已有更旧：window prepend（不 fetch，仅扩窗口）
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

    // prepend 历史维持 scrollTop：按「锚点的视口位移残差」补偿 scrollTop，让用户正在看的
    // 内容保持不动。
    //
    // 残差 = 同一锚点当前的 rect.top − 快照里的 rect.top：正数表示上方插入了内容
    //（prepend 历史），负数表示上方内容减少（加载行移除）。补偿追加到**当前** scrollTop：
    // 浏览器原生 scroll anchoring（Chrome/Firefox）在 layout 阶段已自动补偿时残差为 0，
    // 天然不叠加（2026-11-17 实测：按 scrollHeight delta 从捕获时的 scrollTop 重算，会
    // 把浏览器已施加的补偿再施加一遍，完成瞬间跳 ~219px）。
    //
    // @param armPrefetch 是否设结算窗口：窗口内屏蔽 scroll listener（防补偿自身的 scroll
    //   事件重复触发 prefetch / 误判 fill），窗口结束时若仍在顶部附近自动续拉下一页
    //   （修复「restore 后无 scroll 事件、用户须再滚一下」）。items 变化的结算必开；
    //   RO 高度微调不开——流式高频会把窗口一直顺延，让 scroll listener 长期失聪。
    const reconcileAnchors = useCallback((armPrefetch: boolean) => {
        const scrollBox = scrollBoxRef.current
        if (!scrollBox) return
        const snapshot = anchorSnapshotRef.current
        const boxTop = scrollBox.getBoundingClientRect().top

        // 锚点位移：按视口内锚点顺序找第一个存活的（个别 bubble 被裁/重组时退让下一个）。
        // 只认「此刻仍在视口内」的锚点——快照后用户滚动过、锚点已移出视口时，它的位移
        // 夹带了重排/懒加载等不可信因素，不能用来推视口。
        let shift: number | null = null
        const boxBottom = boxTop + scrollBox.clientHeight
        for (const anchor of snapshot?.anchors ?? []) {
            const el = findBubbleEl(scrollBox, anchor.key)
            if (!el) continue
            const rect = el.getBoundingClientRect()
            if (rect.bottom < boxTop + 1 || rect.top > boxBottom - 1) continue
            shift = rect.top - anchor.top
            break
        }
        if (shift == null && !supportsScrollAnchoring()) {
            // 视口内锚点全灭（整窗重排）且浏览器无原生 anchoring：末尾项 / 高度差兜底。
            // 支持 anchoring 的浏览器不做这份兜底——末尾项在视口外，它的位移不等于视口位移
            const tailEl = snapshot?.tail ? findBubbleEl(scrollBox, snapshot.tail.key) : undefined
            if (tailEl && snapshot?.tail) {
                shift = tailEl.getBoundingClientRect().top - snapshot.tail.top
            } else if (snapshot) {
                shift = scrollBox.scrollHeight - snapshot.scrollHeight
            }
        }

        if (shift) {
            scrollBox.scrollTop += shift
        }

        // 重拍快照：本次内容变化已结算，后续再变化以当前视口状态为基准
        anchorSnapshotRef.current = captureAnchors(scrollBox)

        if (armPrefetch) {
            const restoredScrollTop = scrollBox.scrollTop
            isRestoringScrollRef.current = true
            if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
            scrollRestoreTimerRef.current = setTimeout(() => {
                scrollRestoreTimerRef.current = null
                isRestoringScrollRef.current = false
                if (restoredScrollTop < HISTORY_PREFETCH_DISTANCE) {
                    handleScroll()
                }
            }, RESTORE_SCROLL_GUARD_MS)
        }
    }, [handleScroll])

    // items 变化（加载完成 / window prepend / 加载行增删 / 首拉历史到位）→ 结算式补偿
    useLayoutEffect(() => {
        reconcileAnchors(true)
    }, [items.length, isFetchingNextPage, windowTick, historyLoading, reconcileAnchors])

    // 内容层高度变化（流式增量、tool 卡 / 图片 / 高亮延迟撑高）不改 items 长度但同样
    // 会推挤视口：RO 观测内容层，rAF 合并后走同一套锚点残差补偿（不设结算窗口）
    useEffect(() => {
        const content = scrollBoxRef.current?.querySelector('.ant-bubble-list-scroll-content')
        if (!content) return
        let raf = 0
        const ro = new ResizeObserver(() => {
            if (raf) return
            raf = requestAnimationFrame(() => {
                raf = 0
                reconcileAnchors(false)
            })
        })
        ro.observe(content)
        return () => {
            ro.disconnect()
            if (raf) cancelAnimationFrame(raf)
        }
    }, [reconcileAnchors, items.length > 0])

    // fill 级联：未溢出视口且仍有历史则连续拉页；溢出后停 fill（不钉底，见内注释）。
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
            // 停 fill。溢出后不主动钉底：fill 拉的是更旧内容（prepend 在上方），
            // 锚点补偿已保证用户视线不动；钉底会把正在看的内容瞬移到最新处
            //（2026-11-17 用户反馈「加载完成后内容被上移」的根因之一）
            isFillingRef.current = false
        }
    }, [items.length, isFetchingNextPage])

    // 卸载清孤儿定时器
    useEffect(() => () => {
        if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
    }, [])

    useImperativeHandle(ref, (): BubbleListChatHandle => ({
        scrollToBottom: stickToBottom,
        stopFollow,
    }), [stickToBottom, stopFollow])

    // renderItems：window slice + 顶部 loading。
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
        // 顶部加载行（顺序：首页历史拉取中 → 用户滚到顶拉更旧）：
        // - historyLoading：首页历史未到位但已有实时内容（SSE 先到）——历史行表达「上面还有内容在路上」；
        // - __loading-more__：用户主动滚到顶加载；fill 级联期间不显示（高度来回跳动致抖动）。
        // 两行同一形态（MobiLogo + 文案）——都用高度稳定的品牌动效而非骨架：历史页内容形状
        // 未知，骨架行在真数据替换时会从 1 行跳到几十个 bubble，锚在顶部的用户直接看到跳动。
        const topRows: ChatBubbleItem[] = []
        if (historyLoading) {
            topRows.push({
                key: '__history-loading__',
                role: 'system' as const,
                content: <HistoryLoadingRow />,
            })
        }
        if (isFetchingNextPage && !isFillingRef.current) {
            topRows.push({
                key: '__loading-more__',
                role: 'system' as const,
                content: <HistoryLoadingRow />,
            })
        }
        return topRows.length > 0 ? [...topRows, ...windowed] : windowed
    }, [items, following, isFetchingNextPage, windowTick, historyLoading])

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
