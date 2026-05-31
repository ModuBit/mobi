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
import styled from '@emotion/styled'

const Banner = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: #3d3d3a;
    color: #faf9f5;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`

const RefreshButton = styled.button`
    background: rgba(250, 249, 245, 0.15);
    color: #faf9f5;
    border: 1px solid rgba(250, 249, 245, 0.3);
    border-radius: 4px;
    padding: 2px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
        background: rgba(250, 249, 245, 0.25);
    }
`

interface UpdatePromptProps {
    onUpdate: (() => void) | null
}

export function UpdatePrompt({ onUpdate }: UpdatePromptProps) {
    const { t } = useTranslation()

    if (!onUpdate) return null

    return (
        <Banner>
            <span>{t('notification.pwa.updateAvailable')}</span>
            <RefreshButton onClick={onUpdate}>
                {t('notification.pwa.updateAction')}
            </RefreshButton>
        </Banner>
    )
}
