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

import { useEffect, useState } from 'react'

/**
 * PWA 新版本可用状态的分发核心。
 *
 * registerServiceWorker 只在 MainLayout 注册一次；更新入口（PC 侧栏图标 /
 * 移动端顶栏悬浮钮）分布在不同组件树位置，用模块级 listeners 广播，
 * 各消费方经 useUpdateAvailable 订阅。
 */

type UpdateReload = (() => void) | null

/**
 * state 用对象包装 reload：useState setter 收到函数会被当 updater 调用
 * （setReload(reload) 会把 reload 执行一遍得到 undefined），包装后 setter
 * 只收对象，语义无歧义。
 */
interface UpdateState {
    reload: UpdateReload
}

let currentState: UpdateState = { reload: null }
const listeners = new Set<(state: UpdateState) => void>()

/** MainLayout 的 SW 回调调此方法广播更新可用 */
export function setUpdateReload(reload: UpdateReload): void {
    currentState = { reload }
    listeners.forEach((listener) => listener(currentState))
}

/** 订阅更新可用状态；null = 无新版本（不渲染入口） */
export function useUpdateAvailable(): UpdateReload {
    const [state, setState] = useState<UpdateState>(currentState)

    useEffect(() => {
        listeners.add(setState)
        return () => {
            listeners.delete(setState)
        }
    }, [])

    return state.reload
}
