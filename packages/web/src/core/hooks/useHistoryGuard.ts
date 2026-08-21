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
import { pushHistoryGuard } from '@/core/lib/drawerHistoryGuard'

/**
 * 声明式 history 哨兵：`active` 为 true 期间推一个哨兵，
 * 手势返回（popstate 消费哨兵）时执行 `onBackPressed`。
 *
 * 任何「盖在页面之上的覆盖物」（Drawer / Modal / 全屏面板）都必须接哨兵——
 * 否则移动端手势返回会穿透它去消费**下层覆盖物**的哨兵，表现为
 * 「弹了二级浮层，返回却关了父级」（真机踩过的坑）。
 *
 * @param active 覆盖物可见期（true 推哨兵 / false dispose 弹掉）
 * @param onBackPressed 手势返回时的收起动作（经 ref 持有，引用变化不重推哨兵）
 */
export function useHistoryGuard(active: boolean, onBackPressed: () => void): void {
    const cbRef = useRef(onBackPressed)
    cbRef.current = onBackPressed
    useEffect(() => {
        if (!active) return undefined
        // 闭包经 ref 间接调用，保证 pushHistoryGuard/disposer 匹配到的是同一个稳定引用
        const stable = () => cbRef.current()
        return pushHistoryGuard(stable)
    }, [active])
}
