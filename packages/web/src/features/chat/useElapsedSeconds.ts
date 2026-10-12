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
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useState } from 'react'

/**
 * 运行秒数计时器 hook
 * 每秒刷新 elapsedSeconds，可用于驱动计时器显示和周期性切换等
 */
export function useElapsedSeconds(startedAt: number): number {
    const [seconds, setSeconds] = useState(() =>
        Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    )

    useEffect(() => {
        // startedAt 变化时立即同步更新，消除最长 1 秒的 stale 窗口
        setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
        const timer = setInterval(() => {
            setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
        }, 1000)
        return () => clearInterval(timer)
    }, [startedAt])

    return seconds
}