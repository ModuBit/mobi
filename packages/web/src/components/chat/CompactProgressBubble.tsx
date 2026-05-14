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

import { useEffect, useRef, useState } from 'react'
import { Progress } from 'antd'
import { useTranslation } from 'react-i18next'

/** 压缩进度模拟：递减增速，永远不到 100% */
function nextPercent(prev: number): number {
    if (prev >= 90) return prev + (95 - prev) * 0.03
    if (prev >= 70) return prev + (90 - prev) * 0.06
    return prev + (70 - prev) * 0.12
}

/** 压缩进度条气泡 */
export function CompactProgressBubble() {
    const { t } = useTranslation()
    const [percent, setPercent] = useState(5)
    const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    useEffect(() => {
        const tick = () => {
            setPercent(prev => {
                const next = nextPercent(prev)
                return next >= 98 ? 98 : next
            })
            timerRef.current = setTimeout(tick, 600 + Math.random() * 400)
        }
        timerRef.current = setTimeout(tick, 300)
        return () => clearTimeout(timerRef.current)
    }, [])

    return (
        <div style={{ padding: '8px 0' }}>
            <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
                {t('chat.compacting')}
            </div>
            <Progress
                percent={percent}
                status="active"
                showInfo={false}
                strokeColor={{ from: '#108ee9', to: '#87d068' }}
                size="small"
            />
        </div>
    )
}
