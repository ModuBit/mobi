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

/**
 * 循环轮播 hook：在 values 间按 interval 切换，返回当前值。
 *
 * - prefers-reduced-motion 或单值数组时固定首个（不轮播）。
 * - reduce-motion 通过共享 useMediaQuery 读取（响应中途变化），与 useBootSequence 一致。
 * - 定时器生命周期由 useInterval 原语管理（delay 为 null 时暂停）。
 *
 * 调用方渲染时用 `<FadeText key={value}>{value}</FadeText>` 触发切换淡入。
 */
export function useRotation<T>(values: readonly T[], intervalMs: number): T {
    const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
    const [idx, setIdx] = useState(0)
    const active = !reduce && values.length > 1
    useInterval(
        () => setIdx((i) => (i + 1) % values.length),
        active ? intervalMs : null,
    )
    return values[idx] ?? values[0]
}
