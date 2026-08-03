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

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 距底部小于此像素即视为「在底部」，用于**恢复**跟随。
 *
 * 取值需大于流式增长的单帧幅度（一行文本 ~20-30px），小于「用户想回看上一条」的位移。
 * 40px 让触控板轻扫、橡皮筋回弹这类微小抖动不至于永久掉队，
 * 同时用户真的上滚看历史（通常 > 100px）时不会被强行拉回。
 */
export const AT_BOTTOM_THRESHOLD = 40

/**
 * smooth 滚动的兜底解除时长。
 *
 * 正常路径靠 `scrollend` 事件解除门闩，但该事件仅 Chrome 114+ / Safari 17+ 支持。
 * 无兜底时旧浏览器会让门闩永久闭合 → 流式再也不钉底。
 */
export const SMOOTH_SCROLL_FALLBACK_MS = 1000

/** 内容总高所在层的选择器。Virtuoso 的 scroller 直接子元素是视口层，高度恒等于 clientHeight */
const ITEM_LIST_SELECTOR = '[data-testid="virtuoso-item-list"]'

/**
 * 判断键盘事件的命中的目标是否为「可编辑元素」。
 *
 * keydown 停止跟随监听绑在 window 上（scroller 是无 tabIndex 的 div，焦点常态在
 * composer 输入框内，绑在 scroller 上对多数用户失效）。但用户在输入框里按 PageUp/ArrowUp
 * 时不应被劫持去停止跟随——交给输入框自行处理。故命中可编辑目标时跳过。
 */
function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export interface StickToBottomController {
    /** 传给 Virtuoso 的 scrollerRef */
    handleScrollerRef: (el: HTMLElement | Window | null) => void
    /** 当前是否跟随底部。false 表示用户在看历史 —— 「滚到底」按钮据此显隐 */
    following: boolean
    /** 恢复跟随并滚到底部（供「滚到底」按钮调用） */
    stickToBottom: (behavior?: 'auto' | 'smooth') => void
    /**
     * 内容高度变化回调，接 Virtuoso 的 `totalListHeightChanged`。
     * Virtuoso 测量系统在内部布局 settle 后才触发，此时读 scrollHeight 是最终值——
     * 补 RO 观测 DOM 层的时序差（RO 回调触发时 scrollHeight 可能尚未反映最终布局，
     * 钉到差几十 px 的位置）。
     */
    onContentHeightChange: () => void
}

/**
 * 流式贴底跟随。
 *
 * ## 为什么不用 Virtuoso 的 followOutput
 *
 * `followOutput` 管道只由 **totalCount 变化** 驱动（`dist/index.mjs` 监听 `W(totalCount)`）。
 * 聊天流式回复是把 token 不断追加到**同一个** block —— item 数不变，只是末项越来越高，
 * 整段流式期间 followOutput 一次都不触发（实测长回复偏离底部 1900px+）。
 *
 * 更糟的是它与本 hook 并存时会**互相拉扯**：新消息追加时 followOutput 启动内部 smooth 动画，
 * 而本 hook 的 ResizeObserver 同帧直接改 scrollTop，两个滚动源逐帧抢夺同一个 scrollTop
 * → 视觉上卡顿、跳动。故调用方必须关闭 followOutput，由本 hook 独占滚动权。
 *
 * ## 跟随意图（following）如何演化
 *
 * - 用户主动上滚（wheel 向上 / touchmove 向上 / PageUp·ArrowUp·Home）→ 停止跟随。
 *   停止跟随**只认用户手势**：程序改 scrollTop 不触发 wheel/touchmove/keydown，
 *   而 react-virtuoso 在 item 高度变化时会主动调 scrollTop 维持视觉位置、浏览器在内容变矮时
 *   也会 clamp scrollTop 并派发 scroll——这些都「不在底部」，若用 scroll 几何判「掉队」会被误判。
 * - 用户手动滚回底部附近（距底 ≤ 阈值，由 scroll 几何判定）→ 自动恢复跟随。
 *   缺了这条恢复路径的话，触控板轻扫一下就永久掉队，只能靠点按钮救回来。
 * - 点「滚到底」按钮 → 立即恢复。
 *
 * `following` 同时作为「滚到底」按钮的显隐依据。**不要**改用 Virtuoso 的
 * `atBottomStateChange`：它的判据是 `scrollTop + viewportHeight - scrollHeight > -4px`，
 * 流式期间 scrollHeight 先增、scrollTop 后被钉回，每帧都在 4px 阈值内外翻转 → 按钮闪烁。
 */
export function useStickToBottom(enabled: boolean): StickToBottomController {
    const scrollerElRef = useRef<HTMLElement | null>(null)
    // 跟随意图。ref 供事件/observer 同步读写（避免闭包读到旧值），state 仅用于驱动按钮渲染
    const followRef = useRef(true)
    const [following, setFollowing] = useState(true)

    const setFollow = useCallback((next: boolean) => {
        if (followRef.current === next) return
        followRef.current = next
        setFollowing(next)
    }, [])

    const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
        scrollerElRef.current = el && !(el instanceof Window) ? el : null
    }, [])

    /**
     * smooth 滚动进行中的门闩。
     *
     * smooth 期间沿途 item 被虚拟化逐个测量（估算高度 → 实际高度），item-list 总高持续变化，
     * 会误触发 ResizeObserver 瞬跳，打断 smooth 最后阶段（表现为「最后突然跳一下」）。
     * 高度增量判据挡不住——测量累积也能超过任何小阈值，只能用门闩。
     */
    const smoothScrollingRef = useRef(false)
    const smoothTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const releaseSmoothGate = useCallback(() => {
        smoothScrollingRef.current = false
        if (smoothTimerRef.current !== null) {
            clearTimeout(smoothTimerRef.current)
            smoothTimerRef.current = null
        }
    }, [])

    /** 直接钉到底。不走 Virtuoso 的 scrollToIndex —— 见文件底部说明 */
    const pinToBottom = useCallback(() => {
        const scroller = scrollerElRef.current
        if (!scroller) return
        scroller.scrollTop = scroller.scrollHeight
    }, [])

    /**
     * 跟随中（且非 smooth 门闩期）则钉底。供 RO / totalListHeightChanged / 门闩释放共用。
     *
     * 单一入口的意义：所有「内容可能变化」的信号都走同一条「跟随则钉」逻辑，行为一致、
     * 便于推理。RO 与 Virtuoso 的 totalListHeightChanged 是两路互补信号——前者观测 DOM 层，
     * 后者是 Virtuoso 测量系统的权威通知（在其内部布局 settle 后触发，此时读 scrollHeight
     * 才是最终值，能修 RO 时序差导致的「差几十 px」残留）。
     */
    const pinIfFollowing = useCallback(() => {
        if (!followRef.current) return
        if (smoothScrollingRef.current) return
        pinToBottom()
    }, [pinToBottom])

    /**
     * 门闩解除时补钉：smooth 期间 RO/onScroll/totalListHeightChanged 均被门闩跳过，
     * 若内容在 smooth 进行中变化，最后一次变化未被钉底。门闩解除（scrollend / 定时器兜底 /
     * behavior='auto'）统一在此补一次，避免残留。
     */
    const releaseSmoothGateAndPin = useCallback(() => {
        releaseSmoothGate()
        pinIfFollowing()
    }, [pinIfFollowing, releaseSmoothGate])

    /** 当前几何位置是否在底部附近 */
    const isNearBottom = useCallback(() => {
        const scroller = scrollerElRef.current
        if (!scroller) return true
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_BOTTOM_THRESHOLD
    }, [])

    const stickToBottom = useCallback((behavior: 'auto' | 'smooth' = 'smooth') => {
        setFollow(true)
        const scroller = scrollerElRef.current
        if (!scroller) return
        if (behavior === 'auto') {
            releaseSmoothGateAndPin()
            return
        }
        smoothScrollingRef.current = true
        // scrollend 兜底：不支持该事件的浏览器靠定时器解除门闩；定时器路径也补钉
        //（releaseSmoothGateAndPin 内含 pinIfFollowing）
        if (smoothTimerRef.current !== null) clearTimeout(smoothTimerRef.current)
        smoothTimerRef.current = setTimeout(releaseSmoothGateAndPin, SMOOTH_SCROLL_FALLBACK_MS)
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }, [releaseSmoothGateAndPin, setFollow])

    // scroll → 仅恢复跟随；用户手势 → 停止跟随；scrollend → 解除 smooth 门闩
    //
    // touch 起始 Y：touchmove 据此判断方向（向上拖 = 想看历史）。ref 跨事件保持，不进 state。
    const touchStartYRef = useRef<number | null>(null)
    // 用户正按住指针在 scroller 上（覆盖滚动条拖拽 / 鼠标按住拖动——这两类只产生 scroll，
    // 不产生 wheel/touch/keydown）。ref 跨事件保持，pointerup/pointercancel 在 window 清除。
    const pointerDownRef = useRef(false)

    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return

        // 停止跟随与恢复跟随**刻意用不同信号源**——这是修虚拟化下「高度变化掉队」的关键：
        //
        // 程序发起的 scroll 不止「滚到底部」一种。react-virtuoso 在 item 高度变化时，
        // 内部用 ResizeObserver **主动调整 scrollTop 以维持视觉位置**（补偿视口上方 item 的高度变化），
        // 浏览器在内容变矮时也会 clamp scrollTop（数值减小）并派发 scroll。这两类程序 scroll 落点
        // 都不在底部，若用几何判「掉队」会被误判为「用户上滚」→ following 翻 false → ResizeObserver
        // 不再钉底 → 高度变化时丢失跟随，turn 最后一次修正也没人钉底（滞留几十 px）。
        //
        // 而 wheel / touchmove / keydown **只由真实用户手势触发**——程序改 scrollTop、
        // 浏览器 clamp、Virtuoso 内部调整都不触发它们。故「停止跟随」用手势独占，
        // 几何信号只用于「恢复跟随」（滚回底部附近），后者不存在误判问题。
        const onScroll = () => {
            if (smoothScrollingRef.current) return
            // onScroll 只管「恢复跟随」的 re-entry；钉底由 RO / totalListHeightChanged 独占。
            // 不在 scroll 里 pin：Virtuoso 初始定位（initialTopMostItemIndex 把末项顶到视口顶）
            // 会持续派发 scroll，跟随时若每次 pin 到底会与 Virtuoso 打架 → 初始落点错乱。
            // 停止跟随由手势独占（wheel/touch/keydown 先于 scroll 置 false），几何信号只用于恢复。
            if (isNearBottom()) {
                setFollow(true)
                return
            }
            // 滚动条拖拽 / 鼠标按住拖动只产生 scroll，不产生 wheel/touch/keydown——
            // 这类「指针按下期间」的 scroll 也是真实用户意图，应用几何判停止跟随。
            // 关键安全约束：仅在 pointerDownRef 为真时启用，故 Virtuoso reflow / 程序改 scrollTop
            //（无指针按下）不会被误判，回归「程序改 scrollTop 不掉队」仍成立。
            if (pointerDownRef.current) setFollow(false)
        }

        // 用户向上滚（任意幅度）→ 停止跟随。触控板连续小 wheel 也算——用户能随时滚回底部恢复。
        const onWheelUp = (e: WheelEvent) => {
            if (smoothScrollingRef.current) return
            if (e.deltaY < 0) setFollow(false)
        }

        const onTouchStart = (e: TouchEvent) => {
            touchStartYRef.current = e.touches[0]?.clientY ?? null
        }
        const onTouchMove = (e: TouchEvent) => {
            if (smoothScrollingRef.current) return
            const startY = touchStartYRef.current
            if (startY == null) return
            const curY = e.touches[0]?.clientY
            if (curY == null) return
            // 手指下移（curY > startY）= 内容向上滚 = 想看更旧的历史
            if (curY - startY > 0) setFollow(false)
        }

        const onPointerDown = () => { pointerDownRef.current = true }
        const onPointerUp = () => { pointerDownRef.current = false }

        // 键盘停止跟随绑在 window：scroller 是无 tabIndex 的普通 div，焦点常态在 composer
        // 输入框（scroller 之外），绑在 scroller 上事件到不了 → 对多数用户失效。
        // 命中可编辑元素（输入框等）时跳过，把 PageUp/Home 交回给输入框自行处理。
        const onKeyDownUp = (e: KeyboardEvent) => {
            if (smoothScrollingRef.current) return
            if (isEditableTarget(e.target)) return
            if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') setFollow(false)
        }

        scroller.addEventListener('scroll', onScroll, { passive: true })
        // smooth 结束：解除门闩并补钉（releaseSmoothGateAndPin 内含 pinIfFollowing）。
        // smooth 期间 RO/onScroll/totalListHeightChanged 均被门闩跳过，若内容在 smooth 进行中
        // 变化，最后一次变化未被钉底 → 残留几十 px。scrollend 解闩时补上。
        scroller.addEventListener('scrollend', releaseSmoothGateAndPin, { passive: true })
        scroller.addEventListener('wheel', onWheelUp, { passive: true })
        scroller.addEventListener('touchstart', onTouchStart, { passive: true })
        scroller.addEventListener('touchmove', onTouchMove, { passive: true })
        // pointerdown 绑 scroller：滚动条/内容上的指针按下都能捕获。
        // pointerup/cancel 绑 window：指针在 scroller 外松开（如拖出边界）也能清除标志。
        scroller.addEventListener('pointerdown', onPointerDown, { passive: true })
        window.addEventListener('pointerup', onPointerUp, { passive: true })
        window.addEventListener('pointercancel', onPointerUp, { passive: true })
        window.addEventListener('keydown', onKeyDownUp)
        return () => {
            scroller.removeEventListener('scroll', onScroll)
            scroller.removeEventListener('scrollend', releaseSmoothGateAndPin)
            scroller.removeEventListener('wheel', onWheelUp)
            scroller.removeEventListener('touchstart', onTouchStart)
            scroller.removeEventListener('touchmove', onTouchMove)
            scroller.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerUp)
            window.removeEventListener('keydown', onKeyDownUp)
        }
    }, [enabled, isNearBottom, releaseSmoothGateAndPin, setFollow])

    // 内容增高 → 跟随中则钉底
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return
        const content = scroller.querySelector(ITEM_LIST_SELECTOR)
        if (!content) return

        const observer = new ResizeObserver(pinIfFollowing)
        observer.observe(content)
        return () => observer.disconnect()
    }, [enabled, pinIfFollowing])

    // 卸载时清掉兜底定时器，避免在已销毁组件上跑回调
    useEffect(() => releaseSmoothGate, [releaseSmoothGate])

    return { handleScrollerRef, following, stickToBottom, onContentHeightChange: pinIfFollowing }
}
