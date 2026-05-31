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

import { useEffect, useState } from 'react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { theme as antTheme } from 'antd'
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

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallButton() {
    const { token } = useToken()
    const { t } = useTranslation()
    const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

    useEffect(() => {
        const handler = (e: Event) => {
            e.preventDefault()
            setInstallEvent(e as BeforeInstallPromptEvent)
        }
        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    if (!installEvent) return null

    const handleInstall = async () => {
        await installEvent.prompt()
        setInstallEvent(null)
    }

    return (
        <Tooltip title={t('notification.pwa.installPrompt')} placement="right">
            <NavItem $token={token} onClick={handleInstall}>
                <Download size={20} />
            </NavItem>
        </Tooltip>
    )
}
