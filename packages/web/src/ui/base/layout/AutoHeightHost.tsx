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
 * 内容自适应高度的宿主：给「要有确定高度才肯渲染内容」的第三方组件（pierre 的 PatchDiff 等
 * web component）当容器——高度随内容走，超过上限才内滚。
 *
 * 两段式：先给估计高度（宁大勿小）让首帧有东西可量，量到真正的内容高后收缩到
 * min(内容高, 上限)；内容变化（流式更新）时回到估计高度重来。挂载后异步渲染的组件
 * （首帧只有占位）靠轮询兜——用 setTimeout 不用 rAF：后台 tab 的 rAF 完全暂停，
 * 重新可见时才补跑，卡片会长时间停在估计高度。
 *
 * 量的是**第一个带 shadow root 的后代**：第三方组件的真实内容在它自己的 shadow 里，
 * 从浅 DOM 侧只能看到宿主元素。取 shadow 各子元素实测高度的最大值（contain 无裁剪，
 * 即虚拟化总内容高）。**非 shadow 内容不参与量测**——纯 DOM 内容让 CSS 自己撑高即可，
 * 不需要这个宿主。
 *
 * 还有一处平台细节收在这里：内容在上限内时，把**经典滚动条占掉的盒内空间**补进去
 * （Android/iOS 常见 `offsetHeight - clientHeight = 6`）——不补的话横向一溢出就把内容
 * 挤出几像素的纵向余量，顶出一条假的竖向滚动条。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** 估计初始高度：宁大勿小（首帧后按实际收缩），但封顶防超大内容撑出滚动闪跳 */
const INITIAL_ESTIMATE_HEIGHT = 1600

/** 内容测到后还要再量几轮：滚动条占位会改变目标高度，不收敛会停在中途 */
const SETTLE_PASSES = 3
/** 内容迟迟量不到（异步渲染）时的轮询上限；**也是对消费方的时序承诺**——量到（或放弃
 *  量测）必摘 HEIGHT_PENDING_ATTR 标记，BottomSheet 的入场兜底按它对齐（不得抢先起跳） */
export const MEASURE_TIMEOUT_MS = 2000

/**
 * 「高度还是估计值、尚未量到真实内容」的标记：挂在宿主元素上，量到真实高（或量测超时
 * 兜底放行）后摘除。消费方是 BottomSheet 的入场收敛检测——估计高被容器上限裁住时盒高
 * 恒定不变、scrollHeight 也停在估计值，外部无法从布局区分「估计值的稳定」与「真实值的
 * 稳定」，只能由测量方显式声明。跨模块走 data 属性（不引类名，同 sheetSurface 约定）。
 */
export const HEIGHT_PENDING_ATTR = 'data-height-pending'

/** root 子树里是否还有「高度未量到」的 AutoHeightHost。查询语义收在这里：消费方
 * （BottomSheet 的入场收敛等待等）不自己拼选择器，属性名与判定只有这一处 */
export function hasPendingAutoHeight(root: HTMLElement): boolean {
    return root.querySelector(`[${HEIGHT_PENDING_ATTR}]`) !== null
}

/** 第一个带 shadow root 的后代 = 第三方 web component 的宿主；量它的 shadow 才有意义。
 *  轮询里每 50ms 走一次，故用早退循环而不是 `[...querySelectorAll('*')].find()`（后者每次
 *  都要把整棵子树的节点表摊成数组） */
function findShadowRoot(root: HTMLElement): ShadowRoot | null {
    for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) return node.shadowRoot
    }
    return null
}

/** shadow 各子元素实测高度的最大值 = 内容总高（contain 无裁剪，虚拟化列表也算全量） */
function shadowContentHeight(shadow: ShadowRoot): number {
    let max = 0
    for (const child of shadow.children) max = Math.max(max, child.getBoundingClientRect().height)
    return max
}

export function AutoHeightHost({ maxHeightPx, contentKey, testId, children }: {
    /** 高度上限（px）；null = 不限高（由外层容器负责滚动） */
    maxHeightPx: number | null
    /** 内容标识：变了就重新量（流式更新靠它触发，children 每次渲染都是新引用，不能当依赖） */
    contentKey?: unknown
    testId?: string
    children: ReactNode
}) {
    const hostRef = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number>(INITIAL_ESTIMATE_HEIGHT)

    useEffect(() => {
        // 先回到估计高度再测：旧高度可能小于新内容，会被截断出假读数
        setHeight(INITIAL_ESTIMATE_HEIGHT)
        const el = hostRef.current
        if (!el) return undefined
        const cap = maxHeightPx ?? Number.POSITIVE_INFINITY
        let timer: ReturnType<typeof setTimeout> | undefined
        let passes = 0
        const startedAt = Date.now()
        /** 量到真实高（或放弃量测）后摘标记 */
        const markMeasured = () => { el.removeAttribute(HEIGHT_PENDING_ATTR) }
        const measure = () => {
            const shadow = findShadowRoot(el)
            const contentHeight = shadow ? shadowContentHeight(shadow) : 0
            if (contentHeight > 0) {
                const needed = Math.ceil(contentHeight)
                const scrollbarBox = el.offsetHeight - el.clientHeight
                setHeight(needed <= cap ? needed + scrollbarBox : cap)
                markMeasured()
                if (passes < SETTLE_PASSES) {
                    passes += 1
                    timer = setTimeout(measure, 50)
                }
                return
            }
            if (Date.now() - startedAt < MEASURE_TIMEOUT_MS) timer = setTimeout(measure, 50)
            else markMeasured()
        }
        timer = setTimeout(measure, 50)
        return () => { clearTimeout(timer) }
    }, [contentKey, maxHeightPx])

    // 挂标记必须在 layout effect：消费方 BottomSheet 在它自己的 useLayoutEffect（commit 阶段、
    // 先于本组件的 passive effect 运行）里启动收敛检测与 2000ms 兜底计时——标记若拖到
    // passive effect 才挂上，检测起点可能看不到它，慢路径下兜底抢先起跳、闪烁回归
    // （见 bottom-sheet.tsx 的 waitForContentSettle：「本兜底不得抢先」的承诺以此为前提）
    useLayoutEffect(() => {
        const el = hostRef.current
        el?.setAttribute(HEIGHT_PENDING_ATTR, '')
    }, [contentKey, maxHeightPx])

    return (
        <div
            ref={hostRef}
            data-testid={testId}
            // display:flex 让子级（第三方组件）按内容宽排布，横向溢出留给它自己那层滚动区
            style={{ height, maxHeight: maxHeightPx ?? undefined, overflow: 'auto', display: 'flex' } as CSSProperties}
        >
            {children}
        </div>
    )
}
