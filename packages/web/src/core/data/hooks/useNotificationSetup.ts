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

import { useCallback, useEffect } from 'react'
import { useMobiApi } from '@/core/data/api/client'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useNotificationStore, type NotificationPermission } from '@/core/data/stores/notificationStore'

/**
 * base64url → Uint8Array（VAPID key 转换）
 * Push API 要求 applicationServerKey 为 Uint8Array，
 * 而 hub 返回的 VAPID 公钥是 base64url 字符串。
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const base64Std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64Std)
    // 显式用 ArrayBuffer 构造，使 TS 识别为 Uint8Array<ArrayBuffer>，匹配 PushManager 类型
    const buffer = new ArrayBuffer(raw.length)
    const arr = new Uint8Array(buffer)
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
    return arr
}

/** ready 超时时长（ms）：首装 SW 激活 + skipWaiting 可能到 5-8s，10s 给足余量又不至于让用户觉得卡死 */
const SW_READY_TIMEOUT_MS = 10_000

/** navigator.serviceWorker.ready 超时（controller 孤儿时 ready 永不 resolve 也不 reject） */
class ServiceWorkerReadyTimeout extends Error {
    constructor() {
        super('serviceWorker.ready timeout')
        this.name = 'ServiceWorkerReadyTimeout'
    }
}

/**
 * 等 SW 就绪，超时则 reject ServiceWorkerReadyTimeout（避免 controller 孤儿时永久 pending）。
 * @param timeoutMs 超时（测试可传小值；生产用 SW_READY_TIMEOUT_MS）
 */
function awaitServiceWorkerReady(
    timeoutMs: number = SW_READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> {
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration>((_, reject) =>
            setTimeout(() => reject(new ServiceWorkerReadyTimeout()), timeoutMs),
        ),
    ])
}

/**
 * 通知权限 + Web Push 订阅封装。
 *
 * permission/subscribed/error 来自全局 useNotificationStore——NotificationPermissionGate（全局）
 * 与 NotificationSettings（设置面板）等多消费方订阅同一份状态：一处 enable() 后所有调用方
 * 同步刷新，无需重载页面。
 *
 * ready 超时保护：navigator.serviceWorker.ready 用 awaitServiceWorkerReady 包裹，
 * controller 孤儿时不再永久挂起，超时归为 error.kind='timeout' 给用户可见反馈。
 *
 * enable() 可重复调用（重新授权 / 重新订阅场景）：
 * - permission=default → requestPermission → granted → 订阅并上报
 * - permission=granted → 直接补订阅（不再请求权限）
 * - permission=denied → 返回 'denied'（需用户手动改浏览器设置）
 *
 * @param namespace 当前命名空间。
 *   hub 端 /api/push/subscribe 通过 auth 中间件从 token 自动解析 namespace，
 *   client 无需在 body 显式传入；此参数为调用方语义对齐与未来 unsubscribe 扩展预留。
 * @returns permission 当前权限状态；error 订阅失败原因（null=无）；enable() 触发授权与订阅流程
 */
export function useNotificationSetup(namespace: string) {
    // namespace 当前由 hub 从 token 解析，client 不传；void 标注避免 lint 未用警告
    void namespace
    // useMobiApi 需要 token（见 client.ts 第 246 行 useMobiApi(token)）
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    // 共享 store：多消费方订阅同一份 permission/subscribed/error，一处授权/失败全局同步
    const permission = useNotificationStore((s) => s.permission)
    const subscribed = useNotificationStore((s) => s.subscribed)
    const error = useNotificationStore((s) => s.error)
    const setPermission = useNotificationStore((s) => s.setPermission)
    const setSubscribed = useNotificationStore((s) => s.setSubscribed)
    const setError = useNotificationStore((s) => s.setError)

    // mount 时查询是否已有 push 订阅（跨会话/跨设备可能已订阅过）。
    // 用于决定 granted 状态下是否需要引导「重新订阅」。ready 超时则静默归 false（mount 仅查询，不报错）
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
        let active = true
        awaitServiceWorkerReady()
            .then((reg) => reg.pushManager.getSubscription())
            .then((sub) => {
                if (active) setSubscribed(!!sub)
            })
            .catch(() => {
                if (active) setSubscribed(false)
            })
        return () => {
            active = false
        }
    }, [setSubscribed])

    const enable = useCallback(async (): Promise<NotificationPermission> => {
        if (typeof Notification === 'undefined') return 'denied'

        // 1. 权限阶段
        let perm = Notification.permission
        if (perm === 'default') {
            perm = await Notification.requestPermission()
            setPermission(perm)
        }
        if (perm !== 'granted') return perm

        // 2. 订阅阶段：getVapidKey → (超时保护的) ready → pushManager.subscribe → 上报
        try {
            const { data } = await api.push.getVapidKey()
            const reg = await awaitServiceWorkerReady()
            const subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(data.publicKey),
            })
            await api.push.subscribe(subscription.toJSON())
            setSubscribed(true)
            setError(null) // 成功：清旧 error
        } catch (err) {
            console.error('[notification] push 订阅失败:', err)
            setSubscribed(false)
            // 超时 vs 订阅异常二分类，组件层映射不同文案
            setError({ kind: err instanceof ServiceWorkerReadyTimeout ? 'timeout' : 'subscribe' })
        }
        return perm
    }, [api, setPermission, setSubscribed, setError])

    /**
     * 重新检查权限。denied 后用户在浏览器站点设置改了通知权限，点此感知最新状态
     * （navigator.permissions.query 实时查；不支持 notifications name 时 fallback Notification.permission）。
     */
    const refreshPermission = useCallback(async () => {
        let perm: NotificationPermission = Notification.permission
        try {
            if ('permissions' in navigator) {
                const status = await navigator.permissions.query({ name: 'notifications' })
                perm = status.state as NotificationPermission
            }
        } catch {
            // permissions API 不支持 notifications name，fallback 到 Notification.permission（可能不实时）
        }
        setPermission(perm)
    }, [setPermission])

    return { permission, subscribed, error, enable, refreshPermission }
}
