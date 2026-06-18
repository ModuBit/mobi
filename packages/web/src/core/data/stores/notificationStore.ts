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

import { create } from 'zustand'

/** 通知权限状态（与浏览器 NotificationPermission 对齐） */
export type NotificationPermission = 'default' | 'granted' | 'denied'

/** 订阅失败原因（二分类：超时 / 订阅异常；网络错误归 subscribe） */
export interface NotificationSetupError {
    kind: 'timeout' | 'subscribe'
}

interface NotificationState {
    /** 当前通知权限：授权/订阅/引导文案的三态判定依据 */
    permission: NotificationPermission
    /** 是否已有 Web Push 订阅：granted 下决定是否显示「重新订阅」 */
    subscribed: boolean
    /** 订阅失败原因（null=无错误）；结构化 kind 让组件层 i18n 映射文案，store 不绑文案 */
    error: NotificationSetupError | null
    setPermission: (permission: NotificationPermission) => void
    setSubscribed: (subscribed: boolean) => void
    setError: (error: NotificationSetupError | null) => void
    /** 重置全部状态(换号 logout 时调用,避免新用户继承上一用户状态) */
    reset: () => void
}

/** 模块加载时读取全局权限（生产=浏览器真实值；jsdom/SSR=default） */
function readInitialPermission(): NotificationPermission {
    if (typeof Notification === 'undefined') return 'default'
    return Notification.permission
}

/**
 * 通知状态全局 store（zustand 模块级单例）。
 *
 * 为何共享：NotificationPermissionGate（全局挂载）与 NotificationSettings（设置面板）
 * 各自消费 useNotificationSetup，若各持 useState 会状态隔离——Gate 授权后 Settings
 * 仍显示「未开启」需刷新页面才生效。提取到 store 后，一处 enable() 触发 setPermission，
 * 所有订阅者同步 re-render。
 *
 * error 字段：enable 失败（ready 超时 / subscribe 抛错）时 setError，组件层监听显示反馈。
 *
 * 边界：permission 仅在模块加载与 enable() 内同步，不监听浏览器外部权限变更
 * （用户在站点设置改权限属边缘场景，超出当前 scope）。
 */
export const useNotificationStore = create<NotificationState>((set) => ({
    permission: readInitialPermission(),
    subscribed: false,
    error: null,
    setPermission: (permission) => set({ permission }),
    setSubscribed: (subscribed) => set({ subscribed }),
    setError: (error) => set({ error }),
    reset: () => set({ permission: readInitialPermission(), subscribed: false, error: null }),
}))
