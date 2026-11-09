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

import { useState, useEffect } from 'react'
import { App, theme as antTheme } from 'antd'
import { Button } from '@/ui/base/interactive/button/Button'
import { SyncOutlined } from '@ant-design/icons'
import { Bell, Cloud } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { css, keyframes } from '@emotion/react'
import styled from '@emotion/styled'
import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'
import { awaitServiceWorkerReady } from '@/core/pwa/swReady'
import { SettingGroupCard } from './blocks/SettingGroupCard'
import { SettingRow } from './blocks/SettingRow'
import { GuideSection } from './blocks/GuideSection'
import { PwaCard } from './blocks/PwaCard'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']
type Tone = 'default' | 'success' | 'error'

interface NotificationSettingsProps {
    /** 当前命名空间（daemon 端从 token 解析，client 仅作语义占位） */
    namespace: string
}

// 状态点呼吸（granted 时），scale+opacity 避免依赖具体色值
const breathe = keyframes`
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.85); opacity: 0.25; }
`

const Wrap = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: ${p => p.$token.marginXS}px;
`

const StatusLabel = styled.span<{ $token: Token; $tone: Tone }>`
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => (p.$tone === 'error' ? p.$token.colorErrorText : p.$token.colorText)};
`

// dot：小、状态色，granted 时呼吸。keyframes 用 css 包裹避免插值警告
const Dot = styled.span<{ $color: string; $pulse: boolean }>`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${p => p.$color};
    flex-shrink: 0;
    ${p => p.$pulse && css`
        animation: ${breathe} 2.2s ease-in-out infinite;
        @media (prefers-reduced-motion: reduce) { animation: none; }
    `}
`

// 订阅状态值：等宽字体技术感（沿袭原 SubValue 语言）
const SubValue = styled.span<{ $token: Token; $on: boolean }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 12px;
    letter-spacing: 0.01em;
    color: ${p => (p.$on ? p.$token.colorSuccessText : p.$token.colorTextTertiary)};
`

/**
 * 通知设置分区（SettingRow 行式形态，票05 样板）。
 *
 * 行式分组卡：状态行（权限 dot + 状态文案 + 操作钮）→ 订阅行（值 / 重新订阅）；
 * 权限指引（GuideSection 折叠组）与 PWA 引导卡语义保留。业务逻辑（useNotificationSetup、
 * SW 订阅链路）零改动——只换布局形态。
 */
export function NotificationSettings({ namespace }: NotificationSettingsProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { permission, subscribed, error, enable, refreshPermission } = useNotificationSetup(namespace)
    const { message } = App.useApp()
    // 说明区块折叠态：denied 时默认展开（被禁用户最需要指引）
    const [guideOpen, setGuideOpen] = useState(permission === 'denied')

    // 订阅失败反馈：error 变化时显示对应文案（ready 超时提示刷新，订阅异常提示重试）
    useEffect(() => {
        if (!error) return
        // 固定 key 去重:连续订阅失败(反复点重新订阅)时同 key 更新,而非堆叠多个 toast
        message.error({
            key: 'notification-subscribe-error',
            content:
                error.kind === 'timeout'
                    ? t('notification.settings.swReadyTimeout')
                    : t('notification.settings.subscribeFailed'),
        })
    }, [error, message, t])

    /** 发送测试通知：通过 SW registration.showNotification（移动端 Android Chrome / iOS Safari 不支持页面层 new Notification，必须走 SW）。
     *  带 data.url,点击通知可验证「打开应用 + 跳转会话列表」链路(sw.ts notificationclick → SSEProvider NAVIGATE)。 */
    const sendTest = async () => {
        try {
            // 复用超时保护:controller 孤儿时 ready 永不 resolve,超时归为 testFailed,与 enable() 对齐
            const reg = await awaitServiceWorkerReady()
            await reg.showNotification(t('notification.settings.title'), {
                body: t('notification.settings.testBody'),
                tag: 'test-notification',
                data: { url: '/sessions' },
            })
        } catch {
            message.error(t('notification.settings.testFailed'))
        }
    }

    const tone: Tone = permission === 'granted' ? 'success' : permission === 'denied' ? 'error' : 'default'
    const dotColor =
        tone === 'success' ? token.colorSuccess
        : tone === 'error' ? token.colorError
        : token.colorTextQuaternary
    const statusLabel =
        permission === 'granted' ? t('notification.settings.enabled')
        : permission === 'denied' ? t('notification.settings.statusDenied')
        : t('notification.settings.statusDefault')

    const statusRowLabel = (
        <StatusLabel $token={token} $tone={tone}>
            <Dot $color={dotColor} $pulse={permission === 'granted'} />
            {statusLabel}
        </StatusLabel>
    )

    const subscriptionIcon: LucideIcon = Cloud
    const statusIcon: LucideIcon = Bell

    return (
        <Wrap $token={token}>
            <SettingGroupCard>
                <SettingRow
                    label={statusRowLabel}
                    icon={statusIcon}
                    description={permission === 'denied' ? t('notification.settings.denied') : undefined}
                    variant="action"
                    action={
                        permission === 'default' ? (
                            <Button variant="primary" onClick={() => { void enable() }}>
                                {t('notification.settings.enable')}
                            </Button>
                        ) : permission === 'granted' ? (
                            <Button variant="secondary" onClick={() => { void sendTest() }}>
                                {t('notification.settings.test')}
                            </Button>
                        ) : (
                            <Button variant="secondary" onClick={() => { void refreshPermission() }}>
                                {t('notification.settings.refreshPermission')}
                            </Button>
                        )
                    }
                />
                {permission === 'granted' && !subscribed && (
                    <SettingRow
                        label={t('notification.settings.subscription')}
                        icon={subscriptionIcon}
                        variant="action"
                        action={
                            <Button variant="ghost" size="sm" onClick={() => { void enable() }}>
                                <SyncOutlined /> {t('notification.settings.resubscribe')}
                            </Button>
                        }
                    />
                )}
                {permission === 'granted' && subscribed && (
                    <SettingRow
                        label={t('notification.settings.subscription')}
                        icon={subscriptionIcon}
                        variant="value"
                        value={<SubValue $token={token} $on>{t('notification.settings.subscribed')}</SubValue>}
                    />
                )}
            </SettingGroupCard>

            <GuideSection guideOpen={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />
            <PwaCard />
        </Wrap>
    )
}
