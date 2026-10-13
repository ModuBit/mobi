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
 * 即虚拟化总内容高）。
 *
 * 还有一处平台细节收在这里：内容在上限内时，把**经典滚动条占掉的盒内空间**补进去
 * （Android/iOS 常见 `offsetHeight - clientHeight = 6`）——不补的话横向一溢出就把内容
 * 挤出几像素的纵向余量，顶出一条假的竖向滚动条。
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** 估计初始高度：宁大勿小（首帧后按实际收缩），但封顶防超大内容撑出滚动闪跳 */
const INITIAL_ESTIMATE_HEIGHT = 1600

/** 内容测到后还要再量几轮：滚动条占位会改变目标高度，不收敛会停在中途 */
const SETTLE_PASSES = 3
/** 内容迟迟量不到（异步渲染）时的轮询上限 */
const MEASURE_TIMEOUT_MS = 2000

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
        const measure = () => {
            const host = [...el.querySelectorAll('*')].find((node) => node.shadowRoot !== null)
            const shadow = host?.shadowRoot
            const contentHeight = shadow
                ? Math.max(0, ...[...shadow.children].map((child) => child.getBoundingClientRect().height))
                : 0
            if (contentHeight > 0) {
                const needed = Math.ceil(contentHeight)
                const scrollbarBox = el.offsetHeight - el.clientHeight
                setHeight(needed <= cap ? needed + scrollbarBox : cap)
                if (passes < SETTLE_PASSES) {
                    passes += 1
                    timer = setTimeout(measure, 50)
                }
                return
            }
            if (Date.now() - startedAt < MEASURE_TIMEOUT_MS) timer = setTimeout(measure, 50)
        }
        timer = setTimeout(measure, 50)
        return () => clearTimeout(timer)
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
