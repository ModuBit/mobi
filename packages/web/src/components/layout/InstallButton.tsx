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

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { theme as antTheme } from 'antd'
import { AppTooltip } from '@/components/ui/AppTooltip'
import styled from '@emotion/styled'

const { useToken } = antTheme

const NavItem = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: ${props => props.$token.colorTextSecondary};
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
        color: ${props => props.$token.colorPrimary};
    }
`

const MenuItem = styled.div<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    cursor: pointer;
    color: ${props => props.$token.colorText};
    background: transparent;
    transition: all 0.2s;

    &:hover {
        background: ${props => props.$token.colorPrimaryBg};
    }
`

// 卡片内嵌的紧凑安装按钮（区别于侧边栏菜单项 menu variant：小 padding + 边框，移动端在 PwaCard 内换行全宽）
const CardButton = styled.button<{ $token: ReturnType<typeof useToken>['token'] }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid ${p => p.$token.colorBorder};
    border-radius: ${p => p.$token.borderRadius}px;
    background: transparent;
    color: ${p => p.$token.colorText};
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
        border-color: ${p => p.$token.colorPrimary};
        color: ${p => p.$token.colorPrimary};
        background: ${p => p.$token.colorPrimaryBg};
    }

    /* 移动端：配合 PwaCard flex-wrap，换到下方独占整行 */
    @media (max-width: 575px) {
        width: 100%;
    }
`

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface InstallButtonProps {
    variant?: 'nav' | 'menu' | 'card'
}

export function InstallButton({ variant = 'nav' }: InstallButtonProps) {
    const { token } = useToken()
    const { t } = useTranslation()
    const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
    // iOS 手动指引 Tooltip 受控态:移动端无 hover,点击 toggle 显示步骤
    const [iosTipOpen, setIosTipOpen] = useState(false)

    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault()
            setInstallEvent(e as BeforeInstallPromptEvent)
        }
        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    // iOS Safari 不触发 beforeinstallprompt(installEvent 恒 null)。card 作为设置页主 CTA,
    // 此时不空白,改显示手动安装指引(Tooltip 提示分享→添加到主屏幕)
    const isIos = useMemo(() => {
        if (typeof navigator === 'undefined') return false
        const ua = navigator.userAgent
        // iPhone/iPod 或旧 iPad(含 ipad 字样)
        if (/iphone|ipad|ipod/i.test(ua)) return true
        // iPadOS 13+ 默认「请求桌面网站」→ UA 变 Macintosh(无 ipad),用多点触屏兜底识别 iPad
        if (navigator.maxTouchPoints > 1 && /macintosh|mac os x/i.test(ua)) return true
        return false
    }, [])

    const handleInstall = async () => {
        if (!installEvent) return
        await installEvent.prompt()
        setInstallEvent(null)
    }

    // card variant + iOS + 无 beforeinstallprompt → 手动指引按钮(受控 Tooltip,点击 toggle 显示步骤)
    if (variant === 'card' && !installEvent && isIos) {
        return (
            <AppTooltip title={t('notification.pwa.iosManual')} placement="top" open={iosTipOpen} onOpenChange={setIosTipOpen}>
                <CardButton $token={token} type="button" onClick={() => setIosTipOpen(v => !v)}>
                    <Download size={16} />
                    <span>{t('notification.pwa.install')}</span>
                </CardButton>
            </AppTooltip>
        )
    }

    if (!installEvent) return null

    if (variant === 'menu') {
        return (
            <MenuItem $token={token} onClick={handleInstall}>
                <Download size={20} />
                <span>{t('notification.pwa.install')}</span>
            </MenuItem>
        )
    }

    if (variant === 'card') {
        return (
            <CardButton $token={token} onClick={handleInstall}>
                <Download size={16} />
                <span>{t('notification.pwa.install')}</span>
            </CardButton>
        )
    }

    return (
        <AppTooltip title={t('notification.pwa.installPrompt')} placement="right">
            <NavItem $token={token} onClick={handleInstall}>
                <Download size={20} />
            </NavItem>
        </AppTooltip>
    )
}
