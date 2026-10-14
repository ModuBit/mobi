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
 * 画板头部的下拉关闭手势（移动端）：指针跟手位移 → 松手判去向（请求取消 / 沉降回位）。
 *
 * 与 BottomSheet 的下拉不是一回事，所以没走它的实现：那边是**档位**（peek ↔ 展开 ↔ 关），
 * 判据里要仲裁内容区归属、要有橡皮筋回弹；这里只有一个方向——往下扔就是「取消画板」，
 * 往上没有可去的档，因此没有档位、没有内容区仲裁、也不做负向拉伸。
 *
 * **位移的唯一通道是 `--sheet-drag-y`**：手势写这个变量、退场关键帧读同一个变量，于是
 * 判为关闭时退场动画从手指停住的位置接着走（先弹回 0 再滑出会闪一下）。复位也走它——
 * 载体在关闭被否决（脏数据弹确认）时调 `settle()`，回位由面的 transform 过渡完成。
 *
 * 只有头部吃这个手势（壳给 `.header` 标了 `touch-action: none`）：画布上的笔是画布的，
 * 两者不重叠。
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { dragVelocity, resolveDragDisposition, type DragSample } from '@/ui/base/interactive/resolveDragDisposition'

/** 松手回位时长（ms）：快、无回弹，与壳的过渡语言同档 */
const SETTLE_MS = 200

/** 回位过渡曲线（emotion 侧的 transition 用；与壳的 --mobi-ease-in-out 同族的收尾感） */
export const PULL_SETTLE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
export { SETTLE_MS as PULL_SETTLE_MS }

/** 头部要挂的指针处理器（原样接到 SheetHeader 上） */
export interface HeaderPullHandlers {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

export interface HeaderPullClose {
    /** 跟手位移（px，恒 ≥ 0）：载体写进 `--sheet-drag-y` */
    offset: number
    /** 拖拽中：载体据此关掉面的 transition（否则跟手会拖出黏滞感）并标 data-dragging */
    dragging: boolean
    /** 复位（关闭被否决时由载体调） */
    settle: () => void
    handlers: HeaderPullHandlers
}

/** 不接管手势的落点：真控件（取消 / 全屏 / 完成 / 链接）要能按，标题上的长按选择也要能选 */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]'

export function useHeaderPullClose({ enabled, onPullClose, measureHeight }: {
    /** 只有移动端贴底形态有下拉语义（PC 是停靠矩形） */
    enabled: boolean
    /** 松手判为关闭：调用方的统一取消入口（内部可能弹二次确认） */
    onPullClose: () => void
    /** 面的可视高度：阈值 = 高度 / 3（判据见 resolveDragDisposition） */
    measureHeight: () => number
}): HeaderPullClose {
    const [offset, setOffset] = useState(0)
    const [dragging, setDragging] = useState(false)
    const dragRef = useRef<{ pointerId: number; startY: number; samples: DragSample[] } | null>(null)
    // 回调经 ref 持有：手势处理器必须是稳定引用，否则拖拽中途换手会丢指针捕获
    const onPullCloseRef = useRef(onPullClose)
    onPullCloseRef.current = onPullClose
    const measureRef = useRef(measureHeight)
    measureRef.current = measureHeight

    // 复位只认**重新打开**的上升沿：关闭时清零会把退场关键帧的起点一起清掉（那正是
    // 「从手指停住的位置继续滑出」的来源）
    useEffect(() => {
        if (!enabled) return
        setOffset(0)
        setDragging(false)
        dragRef.current = null
    }, [enabled])

    const settle = useCallback(() => setOffset(0), [])

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || dragRef.current) return
        if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return
        if (event.pointerType === 'mouse' && event.button !== 0) return
        dragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            samples: [{ t: event.timeStamp, y: event.clientY }],
        }
        // 指针捕获：手指移出头部（甚至移出浮层）仍收得到 move/up，否则半途丢手会卡在拖动态
        // （jsdom 与老浏览器可能没实现，缺了只是走冒泡通道，不影响主流程）
        try {
            event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
            /* 指针已经不在了 */
        }
        setDragging(true)
    }, [enabled])

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        drag.samples.push({ t: event.timeStamp, y: event.clientY })
        // 只留够判速度的一小段（dragVelocity 只看最近 80ms）
        if (drag.samples.length > 8) drag.samples.shift()
        // 只吃向下：往上没有可去的档位，不做橡皮筋
        setOffset(Math.max(0, event.clientY - drag.startY))
    }, [])

    const finish = useCallback((event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        dragRef.current = null
        setDragging(false)
        if (cancelled) {
            setOffset(0)
            return
        }
        const dropped = Math.max(0, event.clientY - drag.startY)
        const disposition = resolveDragDisposition({
            offset: dropped,
            velocity: dragVelocity(drag.samples, event.timeStamp),
            height: measureRef.current(),
        })
        // 判为关闭时**位移留着**：退场从这继续；被判为回位（或关闭被否决）才复位
        if (disposition === 'close') onPullCloseRef.current()
        else setOffset(0)
    }, [])

    const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, false), [finish])
    const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, true), [finish])

    return {
        offset,
        dragging,
        settle,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    }
}
