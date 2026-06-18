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
import { theme as antTheme } from 'antd'
import { MobileOutlined } from '@ant-design/icons'
import { enter, IconBox } from './shared'
import { usePwaMode } from '@/components/layout/usePwaMode'
import { InstallButton } from '@/components/layout/InstallButton'

const { useToken } = antTheme
// 块内部 token 类型（不 export）
type Token = ReturnType<typeof useToken>['token']

// 虚线边框次级提示（最轻层级）
const Card = styled.div<{ $token: Token }>`
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

const Text = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
`

const Title = styled.span<{ $token: Token }>`
    font-size: 13px;
    color: ${p => p.$token.colorTextSecondary};
`

const Desc = styled.span<{ $token: Token }>`
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

const Ios = styled.span<{ $token: Token }>`
    font-size: 11.5px;
    color: ${p => p.$token.colorTextQuaternary};
`

/**
 * PWA 安装引导卡（虚线边框，进阶建议）。抽自 NotificationSettings。
 * token 由内部 useToken 获取；已装 PWA（usePwaMode=true）时不渲染。
 */
export function PwaCard() {
    const { t } = useTranslation()
    const { token } = useToken()
    const isPwa = usePwaMode()
    if (isPwa) return null
    return (
        <Card $token={token}>
            <IconBox $token={token} aria-hidden="true">
                <MobileOutlined />
            </IconBox>
            <Text $token={token}>
                <Title $token={token}>{t('notification.settings.installPwa')}</Title>
                <Desc $token={token}>{t('notification.settings.installPwaDesc')}</Desc>
                <Ios $token={token}>{t('notification.settings.installPwaIos')}</Ios>
            </Text>
            <InstallButton variant="card" />
        </Card>
    )
}
