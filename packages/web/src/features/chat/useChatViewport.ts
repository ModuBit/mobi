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

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useStickToBottom } from './useStickToBottom'

/**
 * 聊天列表的视口不变量（chat viewport）。
 *
 * 模块拥有「内容变化时视口怎样保持不动」的全部知识：
 * - 跟随意图：贴底跟随时内容增高 → 平滑追赶；用户上滚阅读历史时 → 锚点补偿保持视线。
 *   意图状态机（手势停止 / 几何恢复 / smooth 门闩 / pointer 守卫）由内部 seam
 *   {@link useStickToBottom} 承载，其测试即本模块的内部 seam 测试。
 * - 锚点补偿：每次内容变化前拍「视口内可见项」的 rect.top 快照，变化后按同一批锚点的
 *   视口位移残差补偿 scrollTop（详见 {@link reconcileAnchors}）。
 * - 快照生命周期与结算窗口：滚动平移、防抖重拍、补偿后屏蔽 scroll 的 RESTORE_SCROLL_GUARD。
 *
 * 加载策略（滚到顶 prefetch / fill 级联 / window 滑动）**不归本模块**——它属于数据拉取，
 * 留在消费组件；两者只在两个 seam 上交汇：
 * - {@link ChatViewport.captureViewportNow}：消费方即将在最上方插入内容时重拍快照；
 * - {@link ChatViewport.onSettled}：补偿结算窗口结束，消费方可重新判定是否继续加载。
 */

/** prepend 历史后 scrollTop 补偿期间，屏蔽 scroll 事件的时间窗（覆盖 RO + rAF 双帧延迟） */
const RESTORE_SCROLL_GUARD_MS = 100
/** 滚动停止后重拍锚点快照的防抖时长 */
const ANCHOR_SNAPSHOT_DEBOUNCE_MS = 80
/** 快照最多记几个视口内锚点（覆盖视口内可见项，个别灭失时退让下一个） */
const MAX_ANCHORS = 8
/** 内容总高所在层：antdx Bubble.List 的 scroller 直接子元素是 `.ant-bubble-list-scroll-content` */
const ITEM_LIST_SELECTOR = '.ant-bubble-list-scroll-content'

/** prepend 补偿的锚点样本：key + 捕获时的 rect.top（视口坐标） */
interface AnchorSample {
    key: string
    top: number
}

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

export interface ChatViewport {
    /** 挂载/卸载 scroller（Bubble.List 的 scrollBox） */
    attach: (el: HTMLElement | null) => void
    /**
     * 用户正在阅读历史（贴底跟随的反面）。驱动「滚到底」按钮显隐，
     * 同时是消费方暂停窗口裁剪（setHistoryReading）、fill 门控的判据。
     */
    reading: boolean
    /** 停止跟随（不动 scrollTop）：程序化跳转（引用定位 scrollIntoView）前调用 */
    stopFollow: () => void
    /** 恢复跟随并滚到底部（供「滚到底」按钮调用） */
    scrollToBottom: (behavior?: 'auto' | 'smooth') => void
    /**
     * items 结构变化（消费方的 layout effect）：结算式补偿 + 开启结算窗口。
     * 内容层高度变化由模块内部 RO 自动接住，不需消费方转发。
     */
    notifyLayoutChanged: () => void
    /**
     * 即将在最上方插入内容（prefetch / fill 触发前）调用：以当前视口重拍锚点快照。
     * 补偿基准必须是「用户此刻看到的内容」——依赖滚动平移的旧快照会在滚动后只剩
     * 视口外锚点，补偿会把视口推偏（实测 1520px）。
     */
    captureViewportNow: () => void
    /** 补偿结算窗口进行中：消费方据此屏蔽自己的 scroll 判定（防补偿自身的 scroll 事件重复触发加载） */
    isSettling: () => boolean
}

export interface ChatViewportOptions {
    /** 结算窗口结束：消费方可重新判定是否继续加载（模块不承载加载策略） */
    onSettled?: () => void
}

export function useChatViewport(enabled: boolean, options: ChatViewportOptions = {}): ChatViewport {
    const { handleScrollerRef, following, stickToBottom, stopFollow, chaseIfFollowing } = useStickToBottom(enabled)
    // following 同步到 ref：RO 分派回调读最新值，不重建 observer
    const followingRef = useRef(following)
    followingRef.current = following

    const scrollerElRef = useRef<HTMLElement | null>(null)
    // 视口锚点快照：每次内容变化后的 layout effect 里重拍，下次内容变化时量残差补偿
    const anchorSnapshotRef = useRef<AnchorSnapshot | null>(null)
    // restore 补偿期间屏蔽 scroll 判定（避免重复触发 prefetch / 误判 fill）
    const isRestoringScrollRef = useRef(false)
    const scrollRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 滚动停止后重拍锚点快照的防抖定时器
    const anchorSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const onSettledRef = useRef(options.onSettled)
    onSettledRef.current = options.onSettled

    const attach = useCallback((el: HTMLElement | null) => {
        scrollerElRef.current = el
        handleScrollerRef(el)
    }, [handleScrollerRef])

    const captureViewportNow = useCallback(() => {
        const scroller = scrollerElRef.current
        if (!scroller) return
        anchorSnapshotRef.current = captureAnchors(scroller)
    }, [])

    const isSettling = useCallback(() => isRestoringScrollRef.current, [])

    /**
     * prepend 历史维持 scrollTop：按「锚点的视口位移残差」补偿 scrollTop，让用户正在看的
     * 内容保持不动。
     *
     * 残差 = 同一锚点当前的 rect.top − 快照里的 rect.top：正数表示上方插入了内容
     *（prepend 历史），负数表示上方内容减少（加载行移除）。补偿追加到**当前** scrollTop：
     * 浏览器原生 scroll anchoring（Chrome/Firefox）在 layout 阶段已自动补偿时残差为 0，
     * 天然不叠加（2026-11-17 实测：按 scrollHeight delta 从捕获时的 scrollTop 重算，会
     * 把浏览器已施加的补偿再施加一遍，完成瞬间跳 ~219px）。
     *
     * @param armPrefetch 是否设结算窗口：窗口内屏蔽消费方的 scroll 判定（防补偿自身的
     *   scroll 事件重复触发 prefetch / 误判 fill），窗口结束时回调 onSettled 交还判定权。
     *   items 变化的结算必开；RO 高度微调不开——流式高频会把窗口一直顺延，让判定长期失聪。
     */
    const reconcileAnchors = useCallback((armPrefetch: boolean) => {
        const scrollBox = scrollerElRef.current
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
        if (shift == null && snapshot) {
            // 视口内锚点全灭（用户在加载期间一直滚动、快照还未来得及重拍）：退回「视口下方」
            // 的锚点——它们只受顶部 prepend 影响，位移仍等于上方插入量；只接受正位移
            //（内容增加方向）。视口上方的锚点混有钉底/裁切位移，不参与。
            for (const anchor of snapshot.anchors) {
                const el = findBubbleEl(scrollBox, anchor.key)
                if (!el) continue
                const rect = el.getBoundingClientRect()
                if (rect.top <= boxBottom - 1) continue
                const delta = rect.top - anchor.top
                if (delta > 0) shift = delta
                break
            }
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
            isRestoringScrollRef.current = true
            if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
            scrollRestoreTimerRef.current = setTimeout(() => {
                scrollRestoreTimerRef.current = null
                isRestoringScrollRef.current = false
                // 无条件交还判定权：消费方的加载判定自带「是否仍在顶部附近」的门控
                //（prefetch 判 scrollTop < 阈值、fill 判未撑满视口），多一次调用是幂等的
                onSettledRef.current?.()
            }, RESTORE_SCROLL_GUARD_MS)
        }
    }, [])

    const notifyLayoutChanged = useCallback(() => {
        reconcileAnchors(true)
    }, [reconcileAnchors])

    // scroll → 平移快照锚点 + 防抖重拍。只管锚点生命周期；prefetch/fill 归消费方的监听。
    //
    // 用户滚动 → O(1) 平移快照锚点：内容未变时锚点的视口 top 随 scrollTop 精确平移，
    // 这样「加载前用户滚过一段」不会混进下一次的残差里。
    // 只在 scrollHeight 未变（内容没动）时平移：内容变化引发的 st 调整（浏览器原生
    // anchoring / 钉底）同时改变了锚点位置，此时平移会把已施加的补偿二次计入残差
    //（实测表现为补偿一倍：56px 增高被补成 112px 位移）。
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return
        const onScroll = () => {
            if (isRestoringScrollRef.current) return
            const snapshot = anchorSnapshotRef.current
            if (snapshot && scroller.scrollHeight === snapshot.scrollHeight) {
                const drift = scroller.scrollTop - snapshot.scrollTop
                if (drift !== 0) {
                    for (const anchor of snapshot.anchors) anchor.top -= drift
                    if (snapshot.tail) snapshot.tail.top -= drift
                    snapshot.scrollTop = scroller.scrollTop
                }
            }

            // 滚动停止后以当前视口重拍快照：连续滚动可能跨过大段内容（快照锚点滑出视口），
            // 之后若有内容变化（首拉历史到位 / 流式增量）就拿不到视口内锚点、无法补偿——
            // 首拉期间用户随手滚动正是这条路径（2026-11-17 用户实测的「加载完成后内容消失」）。
            if (anchorSnapshotTimerRef.current) clearTimeout(anchorSnapshotTimerRef.current)
            anchorSnapshotTimerRef.current = setTimeout(() => {
                anchorSnapshotTimerRef.current = null
                if (isRestoringScrollRef.current) return
                anchorSnapshotRef.current = captureAnchors(scroller)
            }, ANCHOR_SNAPSHOT_DEBOUNCE_MS)
        }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            scroller.removeEventListener('scroll', onScroll)
            if (anchorSnapshotTimerRef.current) {
                clearTimeout(anchorSnapshotTimerRef.current)
                anchorSnapshotTimerRef.current = null
            }
        }
    }, [enabled])

    // 内容层高度变化（流式增量、tool 卡 / 图片 / 高亮延迟撑高）不改 items 长度但同样
    // 会推挤视口：RO 观测内容层，rAF 合并后**按阅读状态互斥分派**——
    // - 跟随中：钉底归平滑追赶（锚点补偿在贴底时无意义），顺带刷新快照基线；
    // - 阅读中：走锚点残差补偿（不设结算窗口）。
    // 单一观测点是本模块的核心不变量：两路滚动控制不得由两个 RO 各自触发。
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return
        const content = scroller.querySelector(ITEM_LIST_SELECTOR)
        if (!content) return
        let raf = 0
        const ro = new ResizeObserver(() => {
            if (raf) return
            raf = requestAnimationFrame(() => {
                raf = 0
                if (followingRef.current) {
                    chaseIfFollowing()
                    // 刷新基线：补偿计算不用，但用户随即上滚时要有一份与当前内容一致的快照
                    anchorSnapshotRef.current = captureAnchors(scroller)
                } else {
                    reconcileAnchors(false)
                }
            })
        })
        ro.observe(content)
        return () => {
            ro.disconnect()
            if (raf) cancelAnimationFrame(raf)
        }
    }, [enabled, chaseIfFollowing, reconcileAnchors])

    // 卸载清孤儿定时器
    useEffect(() => () => {
        if (scrollRestoreTimerRef.current) clearTimeout(scrollRestoreTimerRef.current)
        if (anchorSnapshotTimerRef.current) clearTimeout(anchorSnapshotTimerRef.current)
    }, [])

    return useMemo<ChatViewport>(() => ({
        attach,
        reading: !following,
        stopFollow,
        scrollToBottom: stickToBottom,
        notifyLayoutChanged,
        captureViewportNow,
        isSettling,
    }), [attach, following, stopFollow, stickToBottom, notifyLayoutChanged, captureViewportNow, isSettling])
}
