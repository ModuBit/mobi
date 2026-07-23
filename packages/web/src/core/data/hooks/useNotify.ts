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
 * 统一的「页面内 Toast」hook（antd notification）。
 *
 * 职责边界：本 hook 只负责页面内提示，**不**触发系统通知。
 * 系统通知（SW showNotification）曾是本 hook 的隐式行为——只要已授权就把
 * success/warning/error/info 全部升级为系统通知。这会导致断线、操作反馈等
 * 自愈/低价值事件在已授权时大量弹出系统通知，叠加用户极少点击，触发 Chrome
 * 的通知滥用保护（"可能发送了垃圾内容" + quieter messaging 自动静音）。
 *
 * 现在的分层：
 * - 页面 Toast（本 hook）：用户在前台时可见的即时反馈
 * - 系统通知：由调用方按需「显式」调用 showSystemNotification，仅用于
 *   需要用户介入的高价值事件（工具授权请求、空闲超时、后台 agent 回复）
 */
export function useNotify(): NotifyAPI {
    const { notification } = App.useApp()

    const dispatch = useCallback((type: NotifyType, options: NotifyOptions) => {
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
