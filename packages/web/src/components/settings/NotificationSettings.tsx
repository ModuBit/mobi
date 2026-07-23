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
import { App, Button, theme as antTheme } from 'antd'
import { BellOutlined, CloudOutlined, SyncOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { css, keyframes } from '@emotion/react'
import styled from '@emotion/styled'
import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'
import { awaitServiceWorkerReady } from '@/core/pwa/swReady'
import { enter, IconBox } from './blocks/shared'
import { GuideSection } from './blocks/GuideSection'
import { PwaCard } from './blocks/PwaCard'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']
type Tone = 'default' | 'success' | 'error'

interface NotificationSettingsProps {
    /** 当前命名空间（hub 端从 token 解析，client 仅作语义占位） */
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

// 卡片：无 tone 填充（去 alert 感），容器色 + 细边框 + 留白驱动精致
const Card = styled.section<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    padding: 18px ${p => p.$token.padding}px;
    border-radius: ${p => p.$token.borderRadiusLG}px;
    background: ${p => p.$token.colorBgContainer};
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    animation: ${enter} 0.3s ease-out;
`

const MainRow = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
`

const StatusInfo = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
`

const StatusLine = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: 7px;
`

// dot：小、状态色，granted 时呼吸。keyframes 用 css 包裹避免插值警告
const Dot = styled.span<{ $color: string; $pulse: boolean }>`
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${p => p.$color};
    flex-shrink: 0;
    ${p => p.$pulse && css`animation: ${breathe} 2.2s ease-in-out infinite;`}
`

const Label = styled.span<{ $token: Token; $tone: Tone }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => (p.$tone === 'error' ? p.$token.colorErrorText : p.$token.colorText)};
`

const Desc = styled.span<{ $token: Token }>`
    font-size: 12.5px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
    padding-left: 14px;
`

const Action = styled.div<{ $token: Token }>`
    flex-shrink: 0;
    margin-left: auto;
`

// 订阅行：等宽字体技术感，细线分隔
const SubRow = styled.div<{ $token: Token }>`
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};
`

const SubIcon = styled.span<{ $token: Token; $on: boolean }>`
    color: ${p => (p.$on ? p.$token.colorSuccessText : p.$token.colorTextQuaternary)};
    font-size: 14px;
    display: inline-flex;
    align-items: center;
`

const SubValue = styled.span<{ $token: Token; $on: boolean }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 12px;
    letter-spacing: 0.01em;
    color: ${p => (p.$on ? p.$token.colorSuccessText : p.$token.colorTextTertiary)};
`

/**
 * 通知设置区块（重设计 v2：去 alert 感）。
 *
 * 三层视觉层级：主卡（容器色 + 实线，状态与操作）→ 说明区块（blocks/GuideSection，两层权限指引）
 * → PWA 卡（blocks/PwaCard，进阶建议）。子块抽到 blocks/ 以满足单一职责。
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

    return (
        <Wrap $token={token}>
            <Card $token={token}>
                <MainRow $token={token}>
                    <IconBox $token={token} aria-hidden="true">
                        <BellOutlined />
                    </IconBox>
                    <StatusInfo $token={token}>
                        <StatusLine $token={token}>
                            <Dot $color={dotColor} $pulse={permission === 'granted'} />
                            <Label $token={token} $tone={tone}>{statusLabel}</Label>
                        </StatusLine>
                        {permission === 'denied' && (
                            <Desc $token={token}>{t('notification.settings.denied')}</Desc>
                        )}
                    </StatusInfo>
                    <Action $token={token}>
                        {permission === 'default' && (
                            <Button type="primary" onClick={() => { void enable() }}>
                                {t('notification.settings.enable')}
                            </Button>
                        )}
                        {permission === 'granted' && (
                            <Button onClick={() => { void sendTest() }}>{t('notification.settings.test')}</Button>
                        )}
                        {permission === 'denied' && (
                            <Button onClick={() => { void refreshPermission() }}>
                                {t('notification.settings.refreshPermission')}
                            </Button>
                        )}
                    </Action>
                </MainRow>

                {permission === 'granted' && (
                    <SubRow $token={token}>
                        <SubIcon $token={token} $on={subscribed} aria-hidden="true">
                            <CloudOutlined />
                        </SubIcon>
                        <SubValue $token={token} $on={subscribed}>
                            {subscribed ? t('notification.settings.subscribed') : t('notification.settings.unsubscribed')}
                        </SubValue>
                        {!subscribed && (
                            <Button
                                size="small"
                                type="text"
                                icon={<SyncOutlined />}
                                style={{ marginLeft: 'auto' }}
                                onClick={() => { void enable() }}
                            >
                                {t('notification.settings.resubscribe')}
                            </Button>
                        )}
                    </SubRow>
                )}
            </Card>

            <GuideSection guideOpen={guideOpen} onToggle={() => setGuideOpen((v) => !v)} />
            <PwaCard />
        </Wrap>
    )
}
