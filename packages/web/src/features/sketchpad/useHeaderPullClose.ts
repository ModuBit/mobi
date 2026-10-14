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
 * 往上没有可去的档，因此没有档位、没有内容区仲裁、也不做负向拉伸。共用的是**落点判据**
 * （`DRAG_EXEMPT_SELECTOR`）与**去向判据**（`resolveDragDisposition`）。
 *
 * **位移不进 React state**：一次下拉有 60~120 个 pointermove，进 state 就是每帧重渲整棵浮层树
 * （画板这一层还挂着 excalidraw）。钩子只算状态、每帧调一次 `applyPull` 把「当前拖拽态」交给
 * 载体写进 DOM（载体侧只改一个 CSS 变量与一个属性）。
 *
 * **位移的唯一通道是 `--sheet-drag-y`**：手势写这个变量、退场关键帧读同一个变量，于是
 * 判为关闭时退场动画从手指停住的位置接着走（先弹回 0 再滑出会闪一下）。复位也走它——
 * 载体在关闭被否决（脏数据弹确认）时调 `settle()`，回位由面的 transform 过渡完成。
 *
 * 只有头部吃这个手势（壳给 `.header` 标了 `touch-action: none`）：画布上的笔是画布的，
 * 两者不重叠。
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { DRAG_EXEMPT_SELECTOR, dragVelocity, resolveDragDisposition, type DragSample } from '@/ui/base/interactive/resolveDragDisposition'

/** 松手回位时长（ms）：快、无回弹，与壳的过渡语言同档（载体侧的 transform 过渡用它） */
export const PULL_SETTLE_MS = 200

/** 回位过渡曲线（emotion 侧的 transition 用；与壳的 --mobi-ease-in-out 同族的收尾感） */
export const PULL_SETTLE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** 头部要挂的指针处理器（原样接到 SheetHeader 上） */
export interface HeaderPullHandlers {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

export interface HeaderPullClose {
    /** 复位（关闭被否决时由载体调） */
    settle: () => void
    handlers: HeaderPullHandlers
}

export function useHeaderPullClose({ enabled, open, onPullClose, measureHeight, applyPull }: {
    /** 只有移动端贴底形态有下拉语义（PC 是停靠矩形）——只门控「接不接手势」 */
    enabled: boolean
    /**
     * 浮层是否打开：只用来认**重新打开**并复位位移。不复用 `enabled` 是因为它认不出重开
     * ——退场动画期间浮层仍挂载（`mounted` 仍真），若关闭动画没放完就被重新打开，`enabled`
     * 全程没变，上一次下拉**刻意留着**的位移（给退场关键帧当起点）会留在面上，重开后的
     * 浮层整块停在下沉位置。
     */
    open: boolean
    /** 松手判为关闭：调用方的统一取消入口（内部可能弹二次确认） */
    onPullClose: () => void
    /** 面的可视高度：阈值 = 高度 / 3（判据见 resolveDragDisposition） */
    measureHeight: () => number
    /**
     * 把当前拖拽态写进 DOM（跟手每帧调用）。载体只该改 CSS 变量与属性，不要 setState
     * ——见模块文档「位移不进 React state」。
     * @param offset 跟手位移（px，恒 ≥ 0）
     * @param dragging 是否正在拖拽（载体据此挂 `data-dragging`：抓取光标与「不给 transform
     *                 过渡」，否则跟手会拖出黏滞感）
     */
    applyPull: (offset: number, dragging: boolean) => void
}): HeaderPullClose {
    const dragRef = useRef<{ pointerId: number; startY: number; samples: DragSample[] } | null>(null)
    // 回调经 ref 持有：手势处理器必须是稳定引用，否则拖拽中途换手会丢指针捕获
    const onPullCloseRef = useRef(onPullClose)
    onPullCloseRef.current = onPullClose
    const measureRef = useRef(measureHeight)
    measureRef.current = measureHeight
    const applyRef = useRef(applyPull)
    applyRef.current = applyPull

    /** 打开时复位（上升沿由依赖给出）：关闭那一下故意不清零，见 `open` 的说明 */
    useEffect(() => {
        if (!open) return
        dragRef.current = null
        applyRef.current(0, false)
    }, [open])

    const settle = useCallback(() => applyRef.current(0, false), [])

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || dragRef.current) return
        // 非主指针不起手：多指时主指针在画布上作画，第二根手指落到头部不该把浮层拖走
        // （与 BottomSheet 的 headerDown 同判据）
        if (!event.isPrimary) return
        if (event.target instanceof Element && event.target.closest(DRAG_EXEMPT_SELECTOR)) return
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
        applyRef.current(0, true)
    }, [enabled])

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        drag.samples.push({ t: event.timeStamp, y: event.clientY })
        // 只留够判速度的一小段（dragVelocity 只看最近 80ms）
        if (drag.samples.length > 8) drag.samples.shift()
        // 只吃向下：往上没有可去的档位，不做橡皮筋
        applyRef.current(Math.max(0, event.clientY - drag.startY), true)
    }, [])

    const finish = useCallback((event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        dragRef.current = null
        if (cancelled) {
            applyRef.current(0, false)
            return
        }
        // 落点取**抬起坐标**而不是最后一条 move：甩动可能在同一帧里按下即抬起（一条 move
        // 都没有），按最后一条 move 算位移恒为 0，判据会把这个手势整个吞掉
        const dropped = Math.max(0, event.clientY - drag.startY)
        const disposition = resolveDragDisposition({
            offset: dropped,
            velocity: dragVelocity(drag.samples, event.timeStamp),
            height: measureRef.current(),
        })
        // 判为关闭时**位移留着**：退场从这继续；被判为回位（或关闭被否决）才复位
        if (disposition === 'close') {
            applyRef.current(dropped, false)
            onPullCloseRef.current()
        } else {
            applyRef.current(0, false)
        }
    }, [])

    const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, false), [finish])
    const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => finish(event, true), [finish])

    return {
        settle,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    }
}
