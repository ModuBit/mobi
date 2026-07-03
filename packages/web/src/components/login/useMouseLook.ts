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
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useHasFinePointer } from '@/core/data/hooks/useMediaQuery'

export interface MousePos {
    x: number
    y: number
}

/** 元素布局矩形（getBoundingClientRect 的子集，便于缓存） */
export interface Rect {
    left: number
    top: number
    width: number
    height: number
}

/**
 * 缓存元素布局矩形：仅在 mount 与 window resize 时读取。
 * 避免在 render 期间调用 getBoundingClientRect 触发 forced sync layout（layout thrashing）——
 * 角色带高频 mousemove → setMouse → 重渲染路径上不再读 DOM。
 * 角色舞台为固定像素尺寸，window resize 足以覆盖视口/方向变化。
 */
export function useCachedRect(ref: RefObject<HTMLElement | null>): Rect | null {
    const [rect, setRect] = useState<Rect | null>(null)
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const read = () => {
            const r = el.getBoundingClientRect()
            setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
        }
        read()
        window.addEventListener('resize', read)
        return () => window.removeEventListener('resize', read)
    }, [ref])
    return rect
}

/** 中性鼠标位置（移动端 / 首次渲染）：消费方据此保持中性朝向，不误朝屏幕原点 */
const NEUTRAL_MOUSE: MousePos = { x: 0, y: 0 }

/**
 * 单一鼠标位置源（rAF 节流）。
 * 仅 fine pointer（PC）绑定 mousemove；移动端（coarse pointer）返回中性位置。
 * 全页只应在 CharacterBand 顶层调用一次，mouse 通过 props 下发，
 * 避免 Pupil/EyeBall 各自挂载监听器（此前 9 个监听器 + 高频 setState）。
 */
export function useMouseLook(): MousePos {
    const [mouse, setMouse] = useState<MousePos>(NEUTRAL_MOUSE)
    const finePointer = useHasFinePointer()
    const frame = useRef(0)

    useEffect(() => {
        if (!finePointer) return
        const handler = (e: MouseEvent) => {
            if (frame.current) return
            const x = e.clientX
            const y = e.clientY
            frame.current = requestAnimationFrame(() => {
                frame.current = 0
                setMouse({ x, y })
            })
        }
        window.addEventListener('mousemove', handler, { passive: true })
        return () => {
            window.removeEventListener('mousemove', handler)
            if (frame.current) cancelAnimationFrame(frame.current)
        }
    }, [finePointer])

    return mouse
}

/**
 * 瞳孔 / 脸部偏移的共享几何计算。
 * - forceLook 提供时朝指定方向，并 clamp 到 maxDistance（防止偏出眼白被裁切）
 * - mouse 为中性（移动端 / 首次渲染）时返回 {0,0}，避免误朝屏幕原点（左上）
 */
export function computeLookOffset(
    rect: Rect,
    mouse: MousePos,
    maxDistance: number,
    forceLookX?: number,
    forceLookY?: number,
): { x: number; y: number } {
    if (forceLookX !== undefined && forceLookY !== undefined) {
        const dist = Math.min(Math.hypot(forceLookX, forceLookY), maxDistance)
        if (dist === 0) return { x: 0, y: 0 }
        const angle = Math.atan2(forceLookY, forceLookX)
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
    }
    // 移动端 / 首次渲染：mouse 仍为中性，保持居中
    if (mouse.x === 0 && mouse.y === 0) return { x: 0, y: 0 }
    const dx = mouse.x - (rect.left + rect.width / 2)
    const dy = mouse.y - (rect.top + rect.height / 2)
    const dist = Math.min(Math.hypot(dx, dy), maxDistance)
    if (dist === 0) return { x: 0, y: 0 }
    const angle = Math.atan2(dy, dx)
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }
}
