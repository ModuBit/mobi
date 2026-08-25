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

import { useEffect, useRef } from 'react'
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
 * 设计：手势抑制条 + document 捕获 + 方向锁。
 *
 * - **手势抑制条**（本组件唯一的 DOM）：20px 宽、`touch-action: pan-y` 的固定条。
 *   浏览器把左缘起手的触摸翻译成水平 back 导航时会与右滑开菜单同时触发——popstate
 *   消费菜单刚推的 history 哨兵，菜单闪现即关。touch-action 是唯一可靠的声明式压制
 *   （事件层 preventDefault 来不及，手势在起手早期就被浏览器认领）。取 pan-y 而非
 *   旧浮层的 none：竖向滚动全程放行（none 会吞贴边竖滚，「贴边滚不动」是旧方案废弃
 *   的主因之一）。条不承载检测逻辑（检测仍走 document 捕获），命中期间的点击穿透
 *   转投给下方元素（气泡左缘按钮照常可点）。
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
    const suppressorRef = useRef<HTMLDivElement>(null)

    // 抑制条是 touch-action 载体必须可命中，命中期间的点击转投给下方元素：
    // 暂时摘掉命中（pointerEvents none）→ 取该点最上层元素 → 恢复 → 冒泡派发 click。
    // React 的 onClick 走根容器委托，转投事件带 bubbles 即可到达真实处理器；
    // 抑制条自身不是下方元素的祖先，无双重触发
    const forwardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const strip = suppressorRef.current
        if (!strip) return
        strip.style.pointerEvents = 'none'
        const target = document.elementFromPoint(e.clientX, e.clientY)
        strip.style.pointerEvents = ''
        target?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
        }))
    }

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

    return (
        // 手势抑制条（见组件 docstring）：仅 touch-action 载体 + 点击穿透，
        // zIndex 取低值——须在菜单 Drawer / mask 之下，不干扰弹层交互
        <div
            ref={suppressorRef}
            data-testid="edge-swipe-suppressor"
            aria-hidden={true}
            onClick={forwardClick}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                width: EDGE_WIDTH,
                zIndex: 4,
                touchAction: 'pan-y',
            }}
        />
    )
}
