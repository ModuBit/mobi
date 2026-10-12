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
import { useState } from 'react'
import { useMediaQuery } from '@/core/data/hooks/useMediaQuery'
import { useInterval } from '@/core/data/hooks/useInterval'

/** 终端启动日志的一行（id 供 React key 使用，node 为渲染内容） */
export interface BootLine {
    id: string
    node: React.ReactNode
}

/**
 * 逐行打字机：每 intervalMs 显示一行，全部显示后 done=true。
 * prefers-reduced-motion 时立即全部显示。
 *
 * 定时器生命周期由 useInterval 原语管理：reduce / 空数组 / 到顶 时 delay=null 暂停。
 * 用函数式 setState 累加 visibleCount，无需把 visibleCount 放入定时器 deps。
 */
export function useBootSequence(lines: BootLine[], intervalMs = 150) {
    const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
    const [visibleCount, setVisibleCount] = useState<number>(() =>
        reduce ? lines.length : 0,
    )
    const done = visibleCount >= lines.length
    const active = !reduce && lines.length > 0 && !done
    useInterval(
        () => setVisibleCount((c) => Math.min(c + 1, lines.length)),
        active ? intervalMs : null,
    )
    return { visibleCount, done }
}
