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

import { Button, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'
import { usePwaMode } from '@/components/layout/usePwaMode'
import { InstallButton } from '@/components/layout/InstallButton'

const { Text, Title } = Typography

interface NotificationSettingsProps {
    /** 当前命名空间（hub 端从 token 解析，client 仅作语义占位与未来 unsubscribe 扩展预留） */
    namespace: string
}

/**
 * 通知设置区块：持久的通知权限管理入口。
 *
 * - permission=default：显示「开启通知」按钮，点击触发授权 + push 订阅
 * - permission=granted：显示「已开启」 + 「发送测试通知」（让用户自验 Notification API 是否可用）
 * - permission=denied：显示禁止提示（引导用户到浏览器站点设置）
 * - 非 PWA：附加 PWA 安装引导（Chrome/Edge/Android 显示 InstallButton，iOS 文字兜底）
 *
 * 「发送测试通知」调 `new Notification`，仅验证浏览器通知权限层是否可用，
 * 不覆盖 Web Push 订阅链路（subscribe → hub 存储 → 推送服务）。
 * 作为 Unit 7 Important（subscribe 失败仍返回 granted）的轻量自验兜底。
 */
export function NotificationSettings({ namespace }: NotificationSettingsProps) {
    const { t } = useTranslation()
    const { permission, enable } = useNotificationSetup(namespace)
    const isPwa = usePwaMode()

    /** 发送测试通知（自验 Notification API 权限层；不覆盖 Web Push 订阅链路） */
    const sendTest = () => {
        try {
            new Notification(t('notification.settings.title'), { body: '✓' })
        } catch {
            // ignore（未授权或环境不支持）
        }
    }

    return (
        <div>
            <Title level={5}>{t('notification.settings.title')}</Title>

            {permission === 'granted' && (
                <Space>
                    <Text type="success">{t('notification.settings.enabled')}</Text>
                    <Button size="small" onClick={sendTest}>
                        {t('notification.settings.test')}
                    </Button>
                </Space>
            )}

            {permission === 'default' && (
                <Button type="primary" onClick={() => { void enable() }}>
                    {t('notification.settings.enable')}
                </Button>
            )}

            {permission === 'denied' && (
                <Text type="warning">{t('notification.settings.denied')}</Text>
            )}

            {!isPwa && (
                <div style={{ marginTop: 12 }}>
                    <Text type="secondary">{t('notification.settings.installPwa')}</Text>
                    <div style={{ marginTop: 8 }}>
                        <InstallButton variant="menu" />
                        {/* iOS 无 beforeinstallprompt，文字引导兜底 */}
                        <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                            {t('notification.settings.installPwaIos')}
                        </Text>
                    </div>
                </div>
            )}
        </div>
    )
}
