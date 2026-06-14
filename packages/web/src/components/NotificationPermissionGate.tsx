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

import { useEffect } from 'react'
import { App, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'

/**
 * 模块级守卫：同一页面生命周期内只引导一次（刷新后重置）。
 * 放在 setTimeout 回调内置位，避免 React StrictMode 双调 effect 时被 cleanup 清掉后不再补设。
 */
let permissionPromptShown = false

/**
 * 首次通知权限引导。
 *
 * 页面加载 2s 后检查 Notification.permission：
 * - default：弹带「允许」按钮的引导，点击调用 enable()（授权 + 订阅 push，而非仅 requestPermission）。
 * - denied：弹引导提示用户去浏览器站点设置开启。
 * - granted：什么都不做。
 *
 * 渲染 null（纯副作用组件）。由 SSEProvider 在 token 存在时挂载，
 * 将原本散落在 SSEProvider 内联的权限引导逻辑收敛到此，使其可独立测试。
 */
export function NotificationPermissionGate() {
    const { notification } = App.useApp()
    const { t } = useTranslation()
    const { enable } = useNotificationSetup('')

    useEffect(() => {
        if (typeof Notification === 'undefined') return

        const timerId = setTimeout(() => {
            if (permissionPromptShown) return
            permissionPromptShown = true

            if (Notification.permission === 'default') {
                // 需要用户手势触发浏览器授权弹窗，用带按钮的页面通知承载
                notification.info({
                    key: 'notification-permission-request',
                    title: t('notification.permissionRequest'),
                    description: t('notification.permissionRequestDesc'),
                    duration: 0,
                    actions: [
                        <Button
                            key="allow"
                            type="primary"
                            size="small"
                            onClick={() => {
                                // enable 内部：default → requestPermission → granted → pushManager.subscribe → 上报
                                // 即「授权即订阅」，避免授权后忘了订阅导致 Web Push 链路空转
                                void enable()
                                notification.destroy('notification-permission-request')
                            }}
                        >
                            {t('notification.permissionRequestBtn')}
                        </Button>,
                    ],
                })
            } else if (Notification.permission === 'denied') {
                notification.info({
                    key: 'notification-permission-guide',
                    title: t('notification.permissionGuide'),
                    description: t('notification.permissionGuideDesc'),
                    duration: 10,
                })
            }
        }, 2000)

        return () => clearTimeout(timerId)
    }, [notification, t, enable])

    return null
}
