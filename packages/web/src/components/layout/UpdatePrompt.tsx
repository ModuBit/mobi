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
import { Download, X } from 'lucide-react'
import styled from '@emotion/styled'

const { useToken } = antTheme

/**
 * 「发现新版本」的两个入口形态（2026-09-22 替代原 fixed 横幅——横幅硬编码不随
 * 主题且视觉等级超出「可忽略通知」的语义，见 .scratch/design-walkthrough/REPORT.md A1）：
 * - PC：侧栏 / WCO 标题栏 logo 旁的低调「图标+文案」按钮（UpdateIconButton）
 * - 移动端：顶栏居中悬浮胶囊（UpdatePrompt，会短暂遮住标题）——「刷新」为主操作，
 *   「×」关闭本次提示（关闭后 SW 下次更新才再提示）
 *
 * 更新可用状态经 useUpdateAvailable 订阅；无新版本时入口不渲染。
 */

/** PC：logo 旁的「图标+文案」低调按钮（CollapseButton 同款交互词汇：淡底 hover、无阴影） */
export function UpdateIconButton({ onUpdate }: { onUpdate: () => void }) {
    const { token } = useToken()
    const { t } = useTranslation()

    return (
        <StyledIconButton $token={token} onClick={onUpdate} aria-label={t('notification.pwa.updateAvailable')}>
            <Download size={14} />
            <span>{t('notification.pwa.updateAvailable')}</span>
        </StyledIconButton>
    )
}

const StyledIconButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    font-size: 12.5px;
    border-radius: ${props => props.$token.borderRadiusSM}px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorBgTextHover};
        color: ${props => props.$token.colorPrimary};
    }
`

/** 移动端：顶栏居中悬浮胶囊。primary 高对比提供与顶栏的分离度，不加阴影 */
const FloatingBar = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    position: fixed;
    /* 与原横幅同款 safe-area 顶部内边距逻辑 */
    top: max(8px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    align-items: stretch;
    height: 32px;
    border: none;
    border-radius: ${props => props.$token.borderRadiusLG}px;
    background: ${props => props.$token.colorPrimary};
    color: ${props => props.$token.colorTextLightSolid};
    overflow: hidden;
`

/** 主操作区：整块可点刷新 */
const RefreshArea = styled.button`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px 0 14px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    cursor: pointer;

    &:active {
        opacity: 0.8;
    }
`

/** 分隔细线（浅色描边同源，随胶囊配色） */
const BarDivider = styled.div`
    width: 1px;
    margin: 6px 0;
    background: color-mix(in srgb, currentColor 30%, transparent);
`

/** 关闭：本次提示不再显示（SW 下次更新才再提示） */
const CloseButton = styled.button`
    display: flex;
    align-items: center;
    padding: 0 9px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;

    &:active {
        opacity: 0.8;
    }
`

export function UpdatePrompt({ onUpdate, onClose }: { onUpdate: (() => void) | null; onClose: () => void }) {
    const { token } = useToken()
    const { t } = useTranslation()

    if (!onUpdate) return null

    return (
        <FloatingBar $token={token}>
            <RefreshArea onClick={onUpdate} aria-label={t('notification.pwa.updateAvailable')}>
                <Download size={15} />
                <span>{t('notification.pwa.updateAction')}</span>
            </RefreshArea>
            <BarDivider />
            <CloseButton onClick={onClose} aria-label={t('common.close')}>
                <X size={14} />
            </CloseButton>
        </FloatingBar>
    )
}
