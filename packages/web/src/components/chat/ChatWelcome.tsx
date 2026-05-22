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

import { useMemo } from 'react'
import { Flex, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'

const { Text } = Typography

/** 根据当前小时数判断时段 */
function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) return 'morning'
    if (hour >= 12 && hour < 18) return 'afternoon'
    return 'evening'
}

export function ChatWelcome({ sessionId }: { sessionId?: string }) {
    const { t } = useTranslation()

    const { greeting, subtitle } = useMemo(() => {
        const period = getTimeOfDay()
        return {
            greeting: t(`chat.welcome.${period}`),
            subtitle: t('chat.welcome.subtitle'),
        }
    }, [t])

    return (
        <Flex
            vertical
            align="center"
            justify="center"
            style={{ height: '100%', userSelect: 'none' }}
            gap="middle"
        >
            <PixelAvatar name={sessionId} status="idle" size={72} />
            <Text strong style={{ fontSize: 22, opacity: 0.85 }}>{greeting}</Text>
            <Text style={{ fontSize: 14, opacity: 0.5 }}>{subtitle}</Text>
        </Flex>
    )
}
