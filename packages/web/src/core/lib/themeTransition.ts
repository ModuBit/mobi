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
 * 主题切换的 View Transition 编排——全站主题档位的唯一写入口。
 *
 * 为什么需要这一层：切档的成本不在动画，在 React 提交。写上 `theme` 会重渲整棵树
 * 并改写根上的 `--ant-*` / shadcn 变量，Chrome 再对每个用到 `var()` 的元素重算级联，
 * 实测桌面 ~85ms、4× CPU 降频 ~317ms（inspector 挂文件时更高）。裸切换就是
 * 「冻结这么久 → 硬闪一下」。View Transition 不缩短这段冻结，只是让浏览器先留住旧
 * 快照、等 commit 落定再揭示新快照，把硬切换成一次过渡。
 *
 * 能力门：只做 feature detect 不够——老 Android Chrome 有 API 但快照 + 合成器开销高。
 * 「空更新的首帧延迟」是「支持但用不动」的直接指标（实测桌面 ~50ms / 4× 降频 ~86ms），
 * 故挂载后空闲时跑一次空 transition 自检，超预算即本会话永久降级。主题切换是低频
 * 操作，错过一次动画远好过每次切换都多等一截。
 */

import { flushSync } from 'react-dom'
import { useUiStore, type Theme } from '@/core/data/stores/uiStore'

/** 自检预算：空 transition 的首帧延迟超过此值即判定本机用不动（见文件头「能力门」） */
const FIRST_FRAME_BUDGET_MS = 120

/**
 * 揭示动画的起点（视口坐标，px）。取最近一次指针按下的位置，让遮罩从用户点的那颗
 * 按钮展开——而不是从屏幕中心。键盘触发时不更新，沿用上次指针位置（仍是一个合法起点）。
 */
let lastPointer: { x: number; y: number } | null = null
let pointerTracking = false

/** 自检结论：null = 尚未自检（保守按降级处理），true/false = 已定档且本会话不再改 */
let transitionEnabled: boolean | null = null

/** 浏览器是否具备 View Transition（无则一律直写，动画纯属增量） */
function supportsViewTransition(): boolean {
    return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

/**
 * 用户是否要求减少动效。jsdom / 老内核无 matchMedia 时按「不减少」处理——
 * 缺的这条能力不该把主题切换一起挡掉。
 */
function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 记录指针起点供揭示动画使用；懒挂载——只在自检通过后才装监听器 */
function startPointerTracking(): void {
    if (pointerTracking || typeof window === 'undefined') return
    pointerTracking = true
    window.addEventListener(
        'pointerdown',
        (event) => {
            lastPointer = { x: event.clientX, y: event.clientY }
        },
        { capture: true, passive: true }
    )
}

/**
 * 把揭示起点写进 CSS 变量（styles/view-transition.css 的 keyframes 消费）。
 * 四个方向都要给：inset() 从「退化到该点的零尺寸矩形」展开到全屏。
 * 无指针记录时回落到中心点（四边均 50% 即零尺寸矩形落在视口中心）。
 */
function applyRevealOrigin(): void {
    if (typeof window === 'undefined') return
    const style = document.documentElement.style
    const x = lastPointer?.x ?? window.innerWidth / 2
    const y = lastPointer?.y ?? window.innerHeight / 2
    style.setProperty('--vt-reveal-top', `${y}px`)
    style.setProperty('--vt-reveal-right', `${window.innerWidth - x}px`)
    style.setProperty('--vt-reveal-bottom', `${window.innerHeight - y}px`)
    style.setProperty('--vt-reveal-left', `${x}px`)
}

/**
 * 跑一次空 transition 给本机定档。
 *
 * 内容零变更，所以揭示的是与旧快照完全相同的像素——动画在视觉上不可见；
 * 量到首帧后立刻 skipTransition 收掉合成器占用，不留 220ms 的动画尾巴。
 */
async function probe(): Promise<void> {
    if (!supportsViewTransition() || prefersReducedMotion()) {
        transitionEnabled = false
        return
    }
    let transition: ViewTransition
    const startedAt = performance.now()
    try {
        transition = document.startViewTransition(() => {})
    } catch {
        transitionEnabled = false
        return
    }
    try {
        await transition.ready
    } catch {
        // ready 在 transition 被跳过 / 中断时 reject——按降级处理
        transitionEnabled = false
        return
    }
    const firstFrameMs = performance.now() - startedAt
    transition.skipTransition()
    transitionEnabled = firstFrameMs <= FIRST_FRAME_BUDGET_MS
    if (transitionEnabled) startPointerTracking()
}

/** 让出主线程再自检：挂载时立刻跑会把快照开销压到首屏路径上 */
function whenIdle(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 2000 })
        else setTimeout(resolve, 800)
    })
}

/**
 * 启动自检。由 ThemeProvider 在挂载 effect 里调用一次（全站主题单源），
 * 未自检完成前 switchTheme 保守走直写——错过一次动画，好过押注在不确知的能力上。
 */
export async function warmUpThemeTransition(): Promise<void> {
    if (transitionEnabled !== null) return
    await whenIdle()
    if (transitionEnabled !== null) return
    await probe()
}

/**
 * 切换主题档位——全站唯一写入口（所有 toggle 调用点都经此，别再直接调 store.setTheme）。
 *
 * commit 必须包在 flushSync 里：View Transition 的 update 回调一旦 resolve 就立刻拍新快照，
 * 而 React 默认可能把这次重渲推迟到下一帧，快照就会拍到一个还没换完档的中间态。
 */
export function switchTheme(next: Theme): void {
    const write = () => flushSync(() => useUiStore.getState().setTheme(next))

    // true 已蕴含「具备 View Transition」：该值只由 probe() 置为 true，而它开头就查了这条能力
    if (transitionEnabled !== true) {
        write()
        return
    }

    applyRevealOrigin()
    try {
        // finished 在 transition 被跳过时 reject，无人接管会冒到 unhandledrejection
        document.startViewTransition(write).finished.catch(() => {})
    } catch {
        // 同步抛错时 update 回调尚未执行（档位还没写），直接补上
        write()
    }
}
