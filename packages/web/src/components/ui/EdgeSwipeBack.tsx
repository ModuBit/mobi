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

import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { EDGE_WIDTH, shouldTriggerSwipe } from './shouldTriggerSwipe'

/** 一次手势注册到 window 上的监听的移除函数集合 */
type DetachListener = () => void

/** 批量移除 window 监听 */
const detachWindowListeners = (detachList: DetachListener[]) => {
    for (const detach of detachList) detach()
}

/**
 * 左缘右滑开侧栏（iOS 边缘返回手势的 Web 近似）。
 *
 * 流程：
 * 1. 屏幕最左缘 EDGE_WIDTH 宽的热区捕获 pointerdown；
 * 2. 位移越过迟滞阈值（shouldTriggerSwipe 判定，防误触）后：
 *    - setMobileMenuOpen(true) 打开菜单；
 *    - 远程 start MobileMenuDrawer 注册到 uiStore 的 dragControls，
 *      sheet 1:1 跟手拖出（MobileDrawer 传 dragControls 时 forceRender 常驻可 start），
 *      打开弹入动画由 MobileDrawer 的 isDragging 防御跳过（不与远程拖拽双写），
 *      释放判定（速度符号）复用 MobileDrawer 内统一逻辑；
 * 3. controls 未注册（null，菜单未挂载）时 fallback：仅 setMobileMenuOpen(true)，
 *    菜单走 spring 弹入动画。
 *
 * 仅移动端挂载（ChatPane 内 isMobile 分支），桌面端不渲染。
 */
export function EdgeSwipeBack() {
    // pointerdown 是事件回调（非 effect）注册的 window 监听，React 不会自动回收，
    // 存入 ref 集合（移除函数），unmount effect 中统一移除（防卸载后仍触发）
    const windowListenersRef = useRef<DetachListener[]>([])

    // unmount 清理：移除当前挂着的所有 window 监听
    useEffect(() => () => {
        detachWindowListeners(windowListenersRef.current)
        windowListenersRef.current = []
    }, [])

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const startX = e.clientX
        // 保留原始 pointerdown 事件：motion dragControls.start 需要真实起手事件定位起点
        const startEvent = e.nativeEvent
        let triggered = false

        const onMove = (ev: PointerEvent) => {
            if (triggered) return
            if (!shouldTriggerSwipe(startX, ev.clientX)) return
            triggered = true

            const { setMobileMenuOpen, mobileMenuDragControls } = useUiStore.getState()
            setMobileMenuOpen(true)
            if (mobileMenuDragControls) {
                mobileMenuDragControls.start(startEvent)
            }
            // controls 未注册 fallback：仅 setMobileMenuOpen(true)，菜单 spring 打开
        }

        const cleanup = () => {
            detachWindowListeners(windowListenersRef.current)
            windowListenersRef.current = []
        }

        // 多指防御：后手势赢——先清掉上一组监听再注册新的，
        // 避免多个 pointerdown 各挂一组 onMove 竞争触发
        detachWindowListeners(windowListenersRef.current)
        windowListenersRef.current = [
            () => window.removeEventListener('pointermove', onMove),
            () => window.removeEventListener('pointerup', cleanup),
            () => window.removeEventListener('pointercancel', cleanup),
        ]
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', cleanup)
        window.addEventListener('pointercancel', cleanup)
    }, [])

    return (
        <div
            data-testid="edge-swipe-hotzone"
            aria-hidden={true}
            onPointerDown={handlePointerDown}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                width: EDGE_WIDTH,
                zIndex: 4,
                // 阻止浏览器把触摸翻译成滚动/返回导航，手势全程由 pointer 事件接管
                touchAction: 'none',
            }}
        />
    )
}
