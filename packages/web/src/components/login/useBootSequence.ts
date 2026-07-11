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
import { useEffect, useMemo, useState } from 'react'

/** 终端启动日志的一行（id 供 React key 使用，node 为渲染内容） */
export interface BootLine {
    id: string
    node: React.ReactNode
}

/** 读取 prefers-reduced-motion（mount 时读一次，登录页无需响应中途变化） */
function prefersReducedMotion(): boolean {
    return (
        typeof window !== 'undefined' &&
        !!window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
}

/**
 * 逐行打字机：每 intervalMs 显示一行，全部显示后 done=true。
 * prefers-reduced-motion 时立即全部显示。
 *
 * 实现说明：用 setInterval 而非链式 setTimeout，避免将 visibleCount
 * 放入 effect deps——React 19 下 advanceTimersByTime 多次推进时，状态
 * 更新被批处理、effect 不重跑，链式 timeout 会断链。interval 的回调
 * 用函数式更新，无需重跑 effect 即可累加。
 */
export function useBootSequence(lines: BootLine[], intervalMs = 150) {
    // mount 时读一次（登录页无需响应中途变化）
    const reduce = useMemo(() => prefersReducedMotion(), [])
    const [visibleCount, setVisibleCount] = useState<number>(() =>
        reduce ? lines.length : 0,
    )
    const done = visibleCount >= lines.length

    useEffect(() => {
        // reduced-motion 或空数组时无需定时器（初始 state 已覆盖）
        if (reduce || lines.length === 0) return
        const timer = setInterval(() => {
            setVisibleCount((c) => {
                const next = Math.min(c + 1, lines.length)
                // 到顶后自停止，避免定时器空转到卸载
                if (next >= lines.length) clearInterval(timer)
                return next
            })
        }, intervalMs)
        return () => clearInterval(timer)
        // 只在挂载/关键参数变化时建连；lines.length 变化时重建
    }, [reduce, lines.length, intervalMs])

    return { visibleCount, done }
}
