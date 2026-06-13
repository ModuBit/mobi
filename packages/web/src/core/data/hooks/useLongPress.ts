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

import { useRef, useCallback, useEffect } from 'react'

/** 默认长按延迟（ms） */
const DEFAULT_DELAY = 500

/**
 * 长按手势 hook
 *
 * 触摸指定时长后触发回调；手指移动或抬起时取消。
 * 长按触发后自动拦截紧随的 click，防止误触（如导航）。
 *
 * @example
 * const longPress = useLongPress(() => openMenu(id))
 * <div
 *   onTouchStart={longPress.onTouchStart}
 *   onTouchEnd={longPress.onTouchEnd}
 *   onTouchMove={longPress.onTouchMove}
 *   onClick={longPress.withClickGuard(() => navigate(id))}
 * />
 */
export function useLongPress(onLongPress: () => void, delay = DEFAULT_DELAY) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 长按已触发标记：用于拦截松手后合成的 click
    const triggeredRef = useRef(false)

    // 卸载时清理定时器，避免内存泄漏
    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current)
    }, [])

    const onTouchStart = useCallback(() => {
        triggeredRef.current = false
        timerRef.current = setTimeout(() => {
            triggeredRef.current = true
            onLongPress()
        }, delay)
    }, [onLongPress, delay])

    const cancel = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    /**
     * 包装点击 handler：若长按刚触发，吞掉此次 click
     * 移动端长按松手后浏览器会合成 click，不拦截会导致既弹菜单又触发导航
     */
    const withClickGuard = useCallback((onClick: () => void) => {
        return () => {
            if (triggeredRef.current) {
                triggeredRef.current = false
                return
            }
            onClick()
        }
    }, [])

    return {
        onTouchStart,
        onTouchEnd: cancel,
        onTouchMove: cancel,
        withClickGuard,
    }
}
