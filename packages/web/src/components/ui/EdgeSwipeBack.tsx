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

import { useEffect } from 'react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { EDGE_WIDTH, resolveEdgeSwipeDirection } from './shouldTriggerSwipe'

/** 被跟踪的左缘起手指针 */
interface TrackedPointer {
    pointerId: number
    startX: number
    startY: number
}

/**
 * 左缘右滑开侧栏（iOS 边缘返回手势的 Web 近似）。
 *
 * 设计：无浮层 + document 捕获 + 方向锁。
 *
 * - **无浮层**：组件不渲染任何 DOM（return null），pointer 事件以 capture 挂在
 *   document 上被动观察。旧方案是渲染固定 20px 宽、`touch-action: none` 的热区
 *   浮层，它会吞掉最左缘的竖向滚动与点击（气泡左缘按钮点不到、贴边滚不动），
 *   已废弃。
 * - **方向锁**（resolveEdgeSwipeDirection）：起手后位移未过迟滞前不动作；
 *   水平分量胜出才确认右滑意图 → `setMobileMenuOpen(true)`（菜单 spring 弹入，
 *   产品已决策放弃远程拖拽跟手）；垂直分量胜出说明用户在滚动 → 立即放弃跟踪，
 *   全程无 preventDefault，浏览器滚动不受干扰。
 * - **多指规则**：首个进入热区的指针赢——已跟踪时忽略后续 pointerdown；
 *   pointerup / pointercancel 仅当 pointerId 与被跟踪指针一致时才清理，
 *   其他手指抬起不打断跟踪中的手势（旧实现挂在 window 不分辨指针，多指必断）。
 * - 竖向滑动被浏览器接管滚动时会收到 pointercancel，走同一清理路径闭环。
 *
 * 仅移动端挂载（ChatPane 内 isMobile 分支），桌面端不渲染。
 */
export function EdgeSwipeBack() {
    useEffect(() => {
        // 首个进入热区的被跟踪指针（多指时后进入者不抢占）
        let tracked: TrackedPointer | null = null
        // 已触发标记：一次手势只 setMobileMenuOpen(true) 一次，后续 move 不再动作
        let triggered = false

        // 起手：capture 阶段被动观察 document 上的 pointerdown，不 preventDefault
        const onPointerDown = (e: PointerEvent) => {
            if (tracked) return
            if (e.clientX > EDGE_WIDTH) return
            tracked = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY }
            triggered = false
        }

        // 跟踪：仅处理被跟踪指针的位移，按方向锁决策
        const onPointerMove = (e: PointerEvent) => {
            if (!tracked || e.pointerId !== tracked.pointerId) return
            const direction = resolveEdgeSwipeDirection(
                tracked.startX,
                tracked.startY,
                e.clientX,
                e.clientY,
            )
            if (direction === 'pending') return
            if (direction === 'horizontal') {
                if (!triggered) {
                    triggered = true
                    // 惰性取 store：避免组件层订阅造成多余渲染
                    useUiStore.getState().setMobileMenuOpen(true)
                }
                return
            }
            // 'vertical'：用户在滚动，放弃跟踪交还浏览器
            // （随后浏览器接管滚动会补发 pointercancel，提前清理无妨）
            tracked = null
        }

        // 收尾：仅被跟踪指针的 up / cancel 才清理——其他手指抬起不打断手势
        const endTracking = (e: PointerEvent) => {
            if (tracked && e.pointerId === tracked.pointerId) tracked = null
        }

        document.addEventListener('pointerdown', onPointerDown, { capture: true })
        document.addEventListener('pointermove', onPointerMove, { capture: true })
        document.addEventListener('pointerup', endTracking, { capture: true })
        document.addEventListener('pointercancel', endTracking, { capture: true })

        // 卸载时移除全部监听（capture 标志须与注册一致）
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('pointermove', onPointerMove, true)
            document.removeEventListener('pointerup', endTracking, true)
            document.removeEventListener('pointercancel', endTracking, true)
        }
    }, [])

    return null
}
