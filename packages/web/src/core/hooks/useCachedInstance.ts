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

interface CacheEntry<T> {
    instance: T
    refCount: number
}

// 模块级缓存：key → 实例 + 引用计数；组件卸载不销毁，切回复用
const cache = new Map<string, CacheEntry<unknown>>()
const disposers = new Map<string, ((instance: unknown) => void)>()

/**
 * 显式清理某个 key 的缓存实例（如 session 删除时）。
 * 会调用注册时的 dispose 并移除条目。
 *
 * 限制：若有组件仍挂载（refCount > 0）时调用本函数，dispose 会立即执行，
 * 但已挂载组件持有的 instance 引用不会被告知/置空，会继续使用已销毁的对象。
 * 调用方应确保 clear 发生在相关组件卸载之后（如 session 删除通常先触发路由跳转卸载）。
 */
export function clearCachedInstance(key: string): void {
    const entry = cache.get(key)
    if (!entry) return
    disposers.get(key)?.(entry.instance)
    disposers.delete(key)
    cache.delete(key)
}

/**
 * 清空全部缓存实例（登出/换号时调用）。
 * 逐个调用注册时的 dispose 并移除条目；限制同 clearCachedInstance（refCount>0 时仍执行）。
 */
export function clearAllInstances(): void {
    for (const [key, entry] of cache) {
        disposers.get(key)?.(entry.instance)
        disposers.delete(key)
    }
    cache.clear()
}

interface UseCachedInstanceResult<T> {
    instance: T | null
    isReady: boolean
}

/**
 * 按 key 缓存"昂贵实例"，组件卸载不销毁，切回复用。
 * 仅当 mount 且缓存无该 key 时调用 factory；dispose 仅在 clearCachedInstance 时触发。
 *
 * 首个使用者：终端（xterm + socket）。后续 git diff / 浏览器等可复用。
 *
 * 限制：factory / dispose 仅在首次 mount 时捕获并长期复用（effect 仅依赖 [key]）。
 * 调用方必须保证 factory/dispose 引用稳定（定义为模块级函数或用 useCallback 包裹），
 * 否则后续渲染传入的新引用不会生效。
 */
export function useCachedInstance<T>(
    key: string,
    factory: () => T,
    dispose?: (instance: T) => void,
): UseCachedInstanceResult<T> {
    const [instance, setInstance] = useState<T | null>(null)

    useEffect(() => {
        const existing = cache.get(key) as CacheEntry<T> | undefined
        if (existing) {
            existing.refCount += 1
            setInstance(existing.instance)
        } else {
            const inst = factory()
            cache.set(key, { instance: inst, refCount: 1 })
            if (dispose) {
                disposers.set(key, dispose as (i: unknown) => void)
            }
            setInstance(inst)
        }
        return () => {
            const entry = cache.get(key) as CacheEntry<T> | undefined
            if (entry) {
                entry.refCount = Math.max(0, entry.refCount - 1)
            }
            // 不 dispose：切回复用。显式清理走 clearCachedInstance
        }
        // factory / dispose 闭包变化不应触发重建；仅 key 变化时重新订阅
    }, [key])

    return { instance, isReady: instance !== null }
}
