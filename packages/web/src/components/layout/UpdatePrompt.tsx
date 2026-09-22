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
import { theme as antTheme } from 'antd'
import { Download } from 'lucide-react'
import styled from '@emotion/styled'
import { AppTooltip } from '@/components/ui/AppTooltip'

const { useToken } = antTheme

/**
 * 「发现新版本」的两个入口形态（2026-09-22 替代原 fixed 横幅——横幅硬编码不随
 * 主题且视觉等级超出「可忽略通知」的语义，见 .scratch/design-walkthrough/REPORT.md A1）：
 * - PC：侧栏 / WCO 标题栏 logo 旁的低调图标钮（UpdateIconButton）
 * - 移动端：顶栏居中悬浮圆钮（UpdatePrompt，会短暂遮住标题，点击即刷新消失）
 *
 * 更新可用状态经 useUpdateAvailable 订阅；无新版本时入口不渲染。
 */

const IconColumn = 24

/** PC：logo 旁的低调图标钮（CollapseButton 同款交互词汇：淡底 hover、无阴影） */
export function UpdateIconButton({ onUpdate }: { onUpdate: () => void }) {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <AppTooltip title={t('notification.pwa.updateAvailable')} placement="bottom">
            <StyledIconButton $token={token} onClick={onUpdate} aria-label={t('notification.pwa.updateAvailable')}>
                <Download size={16} />
            </StyledIconButton>
        </AppTooltip>
    )
}

const StyledIconButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: ${IconColumn}px;
    height: 24px;
    padding: 0 2px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextTertiary};
    border-radius: ${props => props.$token.borderRadiusSM}px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
        color: ${props => props.$token.colorPrimary};
    }
`

/** 移动端：顶栏居中悬浮圆钮。primary 高对比提供与顶栏的分离度，不加阴影 */
const FloatingButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    position: fixed;
    /* 与原横幅同款 safe-area 顶部内边距逻辑 */
    top: max(8px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    border: none;
    border-radius: ${props => props.$token.borderRadiusLG}px;
    background: ${props => props.$token.colorPrimary};
    color: ${props => props.$token.colorTextLightSolid};
    font-size: 13px;
    cursor: pointer;
`

export function UpdatePrompt({ onUpdate }: { onUpdate: (() => void) | null }) {
    const { token } = useToken()
    const { t } = useTranslation()

    if (!onUpdate) return null

    return (
        <FloatingButton $token={token} onClick={onUpdate} aria-label={t('notification.pwa.updateAvailable')}>
            <Download size={15} />
            <span>{t('notification.pwa.updateAction')}</span>
        </FloatingButton>
    )
}
