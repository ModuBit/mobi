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

/**
 * 屏幕常亮（Screen Wake Lock）。
 *
 * 用途：会话处于 outputting / awaiting_auth 时，避免手机息屏看不到进度/权限请求。
 *
 * 关键坑点（W3C 规范）：
 * - 页面切后台/最小化时，系统会自动释放 sentinel 且不会自动恢复；
 *   故监听 visibilitychange：后台时显式释放（防个别实现延迟），重新可见时若仍 active 则重新获取。
 * - 仅在页面可见（visibilityState === 'visible'）时请求，否则 request 必失败。
 * - request 可能 reject（NotAllowedError 等），吞掉异常 no-op，不影响主流程。
 * - 浏览器不支持（无 navigator.wakeLock，如 iOS 非 PWA 桌面 Safari）→ 整体静默 no-op。
 *
 * @param active 是否需要常亮；false 时释放当前 sentinel
 */
export function useWakeLock(active: boolean): void {
    const sentinelRef = useRef<WakeLockSentinel | null>(null)

    useEffect(() => {
        if (!('wakeLock' in navigator)) return

        const wakeLock = navigator.wakeLock
        // 卸载标志：await 期间若组件卸载，不再把 sentinel 赋回 ref（否则泄漏到下次 effect）
        let cancelled = false
        // 请求在飞标志：visibilitychange 快速触发时避免并发 request()——前一个 sentinel
        // 会被后一个覆盖且永不 release，导致常亮泄漏到页面卸载
        let acquiring = false

        /** 释放当前 sentinel 并清空引用 */
        const release = async () => {
            const sentinel = sentinelRef.current
            sentinelRef.current = null
            if (sentinel && !sentinel.released) {
                try {
                    await sentinel.release()
                } catch {
                    // 已释放或不可用，忽略
                }
            }
        }

        /** 仅在可见时获取，失败静默 */
        const acquire = async () => {
            // 已有「未释放」的 sentinel 才算占用中；系统在切后台时已自动 release
            // （sentinel.released=true），此时视为失效，需重新获取，不能直接 return
            const current = sentinelRef.current
            if (current && !current.released) return
            sentinelRef.current = null
            // 仅在可见时请求，否则 request 必失败
            if (document.visibilityState !== 'visible') return
            // 防并发：visible 快速切换时避免双发 request
            if (acquiring) return
            acquiring = true
            try {
                const sentinel = await wakeLock.request('screen')
                // await 期间若已卸载 / 切后台 / 被并发 release：立即释放刚拿到的，不占坑，
                // 避免赋回一个已被系统释放的 stale sentinel（否则再次 acquire 会被守卫跳过）
                if (cancelled || document.visibilityState !== 'visible') {
                    try { await sentinel.release() } catch { /* 忽略 */ }
                } else {
                    sentinelRef.current = sentinel
                }
            } catch {
                // NotAllowedError 等吞掉，不影响主流程
            } finally {
                acquiring = false
            }
        }

        /** 页面可见性变化：后台时系统会自动释放 sentinel，但显式 release 更稳妥
         *  （防个别实现延迟），并清空 ref 以便重新可见时重新获取 */
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                void release()
            } else if (active) {
                void acquire()
            }
        }

        if (active) {
            void acquire()
        } else {
            void release()
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
            cancelled = true
            document.removeEventListener('visibilitychange', onVisibilityChange)
            void release()
        }
    }, [active])
}
