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

import { useTranslation } from 'react-i18next'
import { keyframes, css } from '@emotion/react'
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'
import { DownOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { enter, IconBox } from './shared'

const { useToken } = antTheme
// 块内部 token 类型（不 export，避免引用 antd 内部类型触发 TS2883）
type Token = ReturnType<typeof useToken>['token']

/** 说明区块展开：淡入 + 上浮 */
const guideEnter = keyframes`
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
`

// 实线细边框（比 PwaCard 虚线稍重，承载操作指引）；透明背景区分主卡
const Section = styled.section<{ $token: Token }>`
    border: 1px solid ${p => p.$token.colorBorderSecondary};
    border-radius: ${p => p.$token.borderRadiusLG}px;
    background: transparent;
    overflow: hidden;
    animation: ${enter} 0.3s ease-out 30ms backwards;
`

const Header = styled.button<{ $token: Token }>`
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

const Title = styled.span`
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

const Body = styled.div<{ $token: Token }>`
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

    /* 相邻 Step 才加间距（首个 Step 紧贴 PlatformLabel）。
       用 & + & 替代 :first-child——Step 前总有 PlatformLabel，:first-child 永不匹配（死规则），
       且 emotion 对 :first-child 发 SSR 警告。与 PlatformGroup 的 & + & 模式一致 */
    & + & {
        margin-top: 5px;
    }
`

const StepBullet = styled.span<{ $token: Token }>`
    color: ${p => p.$token.colorTextQuaternary};
    flex-shrink: 0;
    line-height: 1.55;
    font-size: 12px;
`

interface GuideSectionProps {
    /** 是否展开（denied 态默认展开，被禁用户最需要指引） */
    guideOpen: boolean
    /** 切换展开 */
    onToggle: () => void
}

/**
 * 可折叠的两层权限指引（浏览器层 / 操作系统层），每层下分平台步骤（macOS/Windows/Android/iOS）。
 * 抽自 NotificationSettings 以满足单一职责（原 530 行内联样式）。token 由内部 useToken 获取。
 *
 * 两层语义（权限链路自上而下）：
 * - 浏览器层：允许浏览器对 Mobi 发送通知（站点级）
 * - 操作系统层：允许操作系统对浏览器发送通知（应用级总开关，被禁时浏览器授权也不弹）
 */
export function GuideSection({ guideOpen, onToggle }: GuideSectionProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    return (
        <Section $token={token}>
            <Header $token={token} aria-expanded={guideOpen} onClick={onToggle}>
                <IconBox $token={token} aria-hidden="true">
                    <InfoCircleOutlined />
                </IconBox>
                <Title>{t('notification.settings.howToAllow')}</Title>
                <Chevron $token={token} $open={guideOpen} aria-hidden="true">
                    <DownOutlined />
                </Chevron>
            </Header>
            {guideOpen && (
                <Body $token={token}>
                    <Layer $token={token} $first>
                        <LayerLabel $token={token}>{t('notification.settings.layerBrowser')}</LayerLabel>
                        <LayerHint $token={token}>{t('notification.settings.layerBrowserHint')}</LayerHint>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>macOS · Windows</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.stepMacWin1')}</Step>
                            <Step $token={token}><StepBullet $token={token}>②</StepBullet>{t('notification.settings.stepMacWin2')}</Step>
                        </PlatformGroup>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>Android</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.stepAndroid1')}</Step>
                            <Step $token={token}><StepBullet $token={token}>②</StepBullet>{t('notification.settings.stepAndroid2')}</Step>
                        </PlatformGroup>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>iOS</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.stepIos1')}</Step>
                            <Step $token={token}><StepBullet $token={token}>②</StepBullet>{t('notification.settings.stepIos2')}</Step>
                        </PlatformGroup>
                    </Layer>
                    <Layer $token={token}>
                        <LayerLabel $token={token}>{t('notification.settings.layerOs')}</LayerLabel>
                        <LayerHint $token={token}>{t('notification.settings.layerOsHint')}</LayerHint>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>macOS</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.osMac')}</Step>
                        </PlatformGroup>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>Windows</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.osWindows')}</Step>
                        </PlatformGroup>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>Android</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.osAndroid')}</Step>
                        </PlatformGroup>
                        <PlatformGroup $token={token}>
                            <PlatformLabel $token={token}>iOS</PlatformLabel>
                            <Step $token={token}><StepBullet $token={token}>①</StepBullet>{t('notification.settings.osIos')}</Step>
                        </PlatformGroup>
                    </Layer>
                </Body>
            )}
        </Section>
    )
}
