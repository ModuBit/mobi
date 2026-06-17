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
import {
    BellOutlined,
    CloudOutlined,
    DownOutlined,
    InfoCircleOutlined,
    MobileOutlined,
    SyncOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { keyframes, css } from '@emotion/react'
import styled from '@emotion/styled'
import { useNotificationSetup } from '@/core/data/hooks/useNotificationSetup'
import { usePwaMode } from '@/components/layout/usePwaMode'
import { InstallButton } from '@/components/layout/InstallButton'

const { useToken } = antTheme

type Token = ReturnType<typeof useToken>['token']
type Tone = 'default' | 'success' | 'error'

interface NotificationSettingsProps {
    /** 当前命名空间（hub 端从 token 解析，client 仅作语义占位） */
    namespace: string
}

// 卡片入场：轻微上浮 + 淡入
const enter = keyframes`
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
`

// 状态点呼吸（granted 时），scale+opacity 避免依赖具体色值
const breathe = keyframes`
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.85); opacity: 0.25; }
`

// 说明区块展开：淡入 + 上浮
const guideEnter = keyframes`
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
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

// 线性图标，中性色，无色块徽章。aria-hidden：旁边有文本，图标为装饰
const IconBox = styled.span<{ $token: Token }>`
    display: grid;
    place-items: center;
    width: 22px;
    flex-shrink: 0;
    color: ${p => p.$token.colorTextSecondary};
    font-size: 17px;
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

// ============ 可折叠说明区块：如何开启通知（两层） ============

// 实线细边框（比 PwaCard 虚线稍重，承载操作指引）；透明背景区分主卡
const GuideSection = styled.section<{ $token: Token }>`
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: ${p => p.$token.borderRadiusLG}px;
    background: transparent;
    overflow: hidden;
    animation: ${enter} 0.3s ease-out 30ms backwards;
`

const GuideHeader = styled.button<{ $token: Token }>`
    width: 100%;
    display: flex;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
    padding: 13px ${p => p.$token.padding}px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: ${p => p.$token.colorTextSecondary};
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    text-align: left;
    transition: background 0.15s ease;

    &:hover {
        background: ${p => p.$token.colorFillQuaternary};
    }
`

const GuideTitle = styled.span`
    flex: 1;
`

// chevron：展开时翻转 180°
const Chevron = styled.span<{ $token: Token; $open: boolean }>`
    color: ${p => p.$token.colorTextQuaternary};
    font-size: 11px;
    display: inline-flex;
    transition: transform 0.2s ease;
    transform: rotate(${p => (p.$open ? 180 : 0)}deg);
`

const GuideBody = styled.div<{ $token: Token }>`
    padding: 0 ${p => p.$token.padding}px 16px;
    animation: ${guideEnter} 0.22s ease-out;
`

// 层容器：层间细分隔（首层无），承载 LayerLabel + Hint + 平台组
const Layer = styled.div<{ $token: Token; $first?: boolean }>`
    ${p =>
        !p.$first &&
        css`
            margin-top: ${p.$token.marginMD}px;
            padding-top: ${p.$token.marginMD}px;
            border-top: 1px solid ${p.$token.colorBorderSecondary};
        `}
`

// 层标签：等宽大写 + 字距，技术感（延续 SubValue 的 fontFamilyCode 语言）
const LayerLabel = styled.div<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: ${p => p.$token.colorTextSecondary};
    font-weight: 600;
    margin-bottom: 3px;
`

// 层语义提示：小字，说明该层权限语义（浏览器对 Mobi / OS 对浏览器）
const LayerHint = styled.div<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextTertiary};
    line-height: 1.45;
    margin-bottom: 10px;
`

// 平台组：层内组间距（相邻组间隔，首组无）
const PlatformGroup = styled.div<{ $token: Token }>`
    & + & {
        margin-top: 10px;
    }
`

// 平台标签：等宽大写 + 字距，技术感
const PlatformLabel = styled.div<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: ${p => p.$token.colorTextTertiary};
    margin-bottom: 8px;
    font-weight: 500;
`

const Step = styled.div<{ $token: Token }>`
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.55;
    color: ${p => p.$token.colorTextSecondary};
    margin-top: 5px;

    &:first-child {
        margin-top: 0;
    }
`

const StepBullet = styled.span<{ $token: Token }>`
    color: ${p => p.$token.colorTextQuaternary};
    flex-shrink: 0;
    line-height: 1.55;
    font-size: 12px;
`

// ============ PWA 引导 ============

// 虚线边框次级提示（最轻层级）
const PwaCard = styled.div<{ $token: Token }>`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${p => p.$token.marginSM}px;
    padding: 12px ${p => p.$token.padding}px;
    border-radius: ${p => p.$token.borderRadiusLG}px;
    background: transparent;
    border: 1px dashed ${p => p.$token.colorBorderSecondary};
    animation: ${enter} 0.3s ease-out 60ms backwards;
`

const PwaText = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
`

const PwaTitle = styled.span<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorTextSecondary};
`

const PwaDesc = styled.span<{ $token: Token }>`
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

const PwaIos = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextQuaternary};
`

/**
 * 通知设置区块（重设计 v2：去 alert 感）。
 *
 * 三层视觉层级：主卡（容器色 + 实线，状态与操作）→ 说明区块（透明 + 实线，可折叠的两层权限指引）
 * → PWA 卡（透明 + 虚线，进阶建议）。
 *
 * 说明区块展开后分两层（权限链路自上而下）：
 * - 浏览器层：允许浏览器对 Mobi 发送通知（站点级）
 * - 操作系统层：允许操作系统对浏览器发送通知（应用级总开关，被禁时浏览器授权也不弹）
 * 每层下列分平台步骤（macOS/Windows/Android/iOS）。denied 态默认展开。
 */
export function NotificationSettings({ namespace }: NotificationSettingsProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const { permission, subscribed, error, enable, refreshPermission } = useNotificationSetup(namespace)
    const isPwa = usePwaMode()
    const { message } = App.useApp()
    // 说明区块折叠态：denied 时默认展开（被禁用户最需要指引）
    const [guideOpen, setGuideOpen] = useState(permission === 'denied')

    // 订阅失败反馈：error 变化时显示对应文案（ready 超时提示刷新，订阅异常提示重试）
    useEffect(() => {
        if (!error) return
        message.error(
            error.kind === 'timeout'
                ? t('notification.settings.swReadyTimeout')
                : t('notification.settings.subscribeFailed'),
        )
    }, [error, message, t])

    /** 发送测试通知：通过 SW registration.showNotification（移动端 Android Chrome / iOS Safari 不支持页面层 new Notification，必须走 SW） */
    const sendTest = async () => {
        try {
            const reg = await navigator.serviceWorker.ready
            await reg.showNotification(t('notification.settings.title'), { body: '✓' })
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

            <GuideSection $token={token}>
                <GuideHeader
                    $token={token}
                    aria-expanded={guideOpen}
                    onClick={() => setGuideOpen((v) => !v)}
                >
                    <IconBox $token={token} aria-hidden="true">
                        <InfoCircleOutlined />
                    </IconBox>
                    <GuideTitle>{t('notification.settings.howToAllow')}</GuideTitle>
                    <Chevron $token={token} $open={guideOpen} aria-hidden="true">
                        <DownOutlined />
                    </Chevron>
                </GuideHeader>
                {guideOpen && (
                    <GuideBody $token={token}>
                        <Layer $token={token} $first>
                            <LayerLabel $token={token}>{t('notification.settings.layerBrowser')}</LayerLabel>
                            <LayerHint $token={token}>{t('notification.settings.layerBrowserHint')}</LayerHint>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>macOS · Windows</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.stepMacWin1')}
                                </Step>
                                <Step $token={token}>
                                    <StepBullet $token={token}>②</StepBullet>
                                    {t('notification.settings.stepMacWin2')}
                                </Step>
                            </PlatformGroup>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>Android</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.stepAndroid1')}
                                </Step>
                                <Step $token={token}>
                                    <StepBullet $token={token}>②</StepBullet>
                                    {t('notification.settings.stepAndroid2')}
                                </Step>
                            </PlatformGroup>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>iOS</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.stepIos1')}
                                </Step>
                                <Step $token={token}>
                                    <StepBullet $token={token}>②</StepBullet>
                                    {t('notification.settings.stepIos2')}
                                </Step>
                            </PlatformGroup>
                        </Layer>
                        <Layer $token={token}>
                            <LayerLabel $token={token}>{t('notification.settings.layerOs')}</LayerLabel>
                            <LayerHint $token={token}>{t('notification.settings.layerOsHint')}</LayerHint>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>macOS</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.osMac')}
                                </Step>
                            </PlatformGroup>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>Windows</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.osWindows')}
                                </Step>
                            </PlatformGroup>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>Android</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.osAndroid')}
                                </Step>
                            </PlatformGroup>
                            <PlatformGroup $token={token}>
                                <PlatformLabel $token={token}>iOS</PlatformLabel>
                                <Step $token={token}>
                                    <StepBullet $token={token}>①</StepBullet>
                                    {t('notification.settings.osIos')}
                                </Step>
                            </PlatformGroup>
                        </Layer>
                    </GuideBody>
                )}
            </GuideSection>

            {!isPwa && (
                <PwaCard $token={token}>
                    <IconBox $token={token} aria-hidden="true">
                        <MobileOutlined />
                    </IconBox>
                    <PwaText $token={token}>
                        <PwaTitle $token={token}>{t('notification.settings.installPwa')}</PwaTitle>
                        <PwaDesc $token={token}>{t('notification.settings.installPwaDesc')}</PwaDesc>
                        <PwaIos $token={token}>{t('notification.settings.installPwaIos')}</PwaIos>
                    </PwaText>
                    <InstallButton variant="card" />
                </PwaCard>
            )}
        </Wrap>
    )
}
