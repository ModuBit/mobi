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

export interface StickToBottomController {
    /** 传给 Virtuoso 的 scrollerRef */
    handleScrollerRef: (el: HTMLElement | Window | null) => void
    /** 当前是否跟随底部。false 表示用户在看历史 —— 「滚到底」按钮据此显隐 */
    following: boolean
    /** 恢复跟随并滚到底部（供「滚到底」按钮调用） */
    stickToBottom: (behavior?: 'auto' | 'smooth') => void
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
 * - 用户主动上滚（wheel / touchmove）且已离开底部 → 停止跟随。
 *   程序改 scrollTop 不触发这两个事件，所以它们是「用户主动操作」最干净的信号。
 * - 用户手动滚回底部附近（距底 ≤ 阈值）→ 自动恢复跟随。
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
            releaseSmoothGate()
            pinToBottom()
            return
        }
        smoothScrollingRef.current = true
        // scrollend 兜底：不支持该事件的浏览器靠定时器解除门闩
        if (smoothTimerRef.current !== null) clearTimeout(smoothTimerRef.current)
        smoothTimerRef.current = setTimeout(releaseSmoothGate, SMOOTH_SCROLL_FALLBACK_MS)
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }, [pinToBottom, releaseSmoothGate, setFollow])

    // scroll → 双向同步跟随意图；scrollend → 解除 smooth 门闩
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return

        // 单个 scroll 处理器双向同步，几何位置即唯一真相源。
        //
        // 为何 scroll 事件足以区分「用户滚动」与「程序滚动」：程序侧**只会滚到底部**
        //（pinToBottom / stickToBottom），所以落点不在底部的 scroll 必然来自用户。
        //
        // 为何不用 wheel/touchmove 判「用户想离开」：wheel 在滚动**发生前**触发，
        // 此刻读到的还是位移前的位置——用户正贴底时向上滚，wheel 里判断仍是「在底部」，
        // 于是不停止跟随，observer 继续钉底，用户在流式期间根本滚不上去。
        //
        // 为何流式增长不会误判掉队：内容变高只增 scrollHeight，**不触发 scroll 事件**，
        // 本处理器不会被调用；随后 observer 钉底触发的 scroll 落点在底部 → 保持跟随。
        // （Virtuoso 的 atBottomStateChange 会在 resize 时重算状态，故有此误判，本处理器没有。）
        // 例外：程序发起的 smooth 滚动会经过一串「不在底部」的中间位置，
        // 门闩期间跳过，否则动画途中 following 被反复置 false（按钮闪回）。
        const onScroll = () => {
            if (smoothScrollingRef.current) return
            setFollow(isNearBottom())
        }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        scroller.addEventListener('scrollend', releaseSmoothGate, { passive: true })
        return () => {
            scroller.removeEventListener('scroll', onScroll)
            scroller.removeEventListener('scrollend', releaseSmoothGate)
        }
    }, [enabled, isNearBottom, releaseSmoothGate, setFollow])

    // 内容增高 → 跟随中则钉底
    useEffect(() => {
        const scroller = scrollerElRef.current
        if (!enabled || !scroller) return
        const content = scroller.querySelector(ITEM_LIST_SELECTOR)
        if (!content) return

        const observer = new ResizeObserver(() => {
            if (!followRef.current) return
            if (smoothScrollingRef.current) return
            pinToBottom()
        })
        observer.observe(content)
        return () => observer.disconnect()
    }, [enabled, pinToBottom])

    // 卸载时清掉兜底定时器，避免在已销毁组件上跑回调
    useEffect(() => releaseSmoothGate, [releaseSmoothGate])

    return { handleScrollerRef, following, stickToBottom }
}
