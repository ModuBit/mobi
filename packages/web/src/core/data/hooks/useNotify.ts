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

import { useCallback, useMemo } from 'react'
import { App } from 'antd'
import { showSystemNotification } from '@/core/notifications'

/** 通知选项 */
export interface NotifyOptions {
    /** 通知唯一标识，可用于 destroy 关闭 */
    key?: string
    /** 通知标题 */
    message: string
    /** 通知描述 */
    description?: string
    /** 自动关闭秒数，0=不关闭 */
    duration?: number
}

/** 通知类型 */
type NotifyType = 'success' | 'warning' | 'error' | 'info'

/** 通知 API */
export interface NotifyAPI {
    success: (options: NotifyOptions) => void
    warning: (options: NotifyOptions) => void
    error: (options: NotifyOptions) => void
    info: (options: NotifyOptions) => void
    /** 关闭指定 key 的通知（仅页面通知支持） */
    destroy: (key: string) => void
}

/**
 * 统一通知 hook
 *
 * 已授权浏览器通知 → SW 系统通知（showSystemNotification，跨端一致）
 * 未授权 → 使用 antd notification (页面内通知)
 */
export function useNotify(): NotifyAPI {
    const { notification } = App.useApp()

    const dispatch = useCallback((type: NotifyType, options: NotifyOptions) => {
        // 已授权浏览器通知 → SW 系统通知（移动端不支持页面层 new Notification），SW 失败降级 antd
        if ('Notification' in window && Notification.permission === 'granted') {
            void showSystemNotification({
                title: options.message,
                body: options.description ?? '',
                icon: '/brand/favicon.ico',
            }).then((ok) => {
                if (ok) return
                notification[type]({
                    key: options.key,
                    message: options.message,
                    description: options.description,
                    duration: options.duration,
                })
            })
            return
        }

        // 未授权 → 使用 antd 页面通知
        notification[type]({
            key: options.key,
            message: options.message,
            description: options.description,
            duration: options.duration,
        })
    }, [notification])

    const destroy = useCallback((key: string) => {
        notification.destroy(key)
    }, [notification])

    const success = useCallback((options: NotifyOptions) => dispatch('success', options), [dispatch])
    const warning = useCallback((options: NotifyOptions) => dispatch('warning', options), [dispatch])
    const error = useCallback((options: NotifyOptions) => dispatch('error', options), [dispatch])
    const info = useCallback((options: NotifyOptions) => dispatch('info', options), [dispatch])

    return useMemo(() => ({ success, warning, error, info, destroy }), [success, warning, error, info, destroy])
}
