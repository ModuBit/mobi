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

import styled from '@emotion/styled'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CacheStatus } from '@mobi/shared'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'

/**
 * prompt cache 过期提示——聊天流末尾的「系统动作行」。
 *
 * 与 CommandProgressBubble 同一视觉词汇：无边框/阴影的轻行，mono 小字。
 * 区别是静态信息（不是进行中），所以不带 PixelLoader / 扫光，警告色 + 图标传达状态。
 *
 * 数据来源：会话恢复（resume/fork）时 SDK SessionStart hook 上报的 cacheStatus，
 * 首轮 result 后 CLI 清空 → 本行自动消失（不是每轮都提示）。
 */

const Row = styled.div`
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 6px 0;
`

const WarnIcon = styled.span`
    display: inline-flex;
    flex: none;
    margin-top: 2px;
    color: var(--ant-color-warning);
`

const Title = styled.span`
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--ant-color-warning);
    letter-spacing: .01em;
`

const Detail = styled.span`
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ant-color-text-tertiary);
`

export interface CacheExpiredRowProps {
    /** 会话恢复时的 prompt cache 状态（调用方保证 expired=true） */
    cacheStatus: CacheStatus
}

export function CacheExpiredRow({ cacheStatus }: CacheExpiredRowProps) {
    const { t } = useTranslation()

    // 重缓存规模 / 成本缺省时省略；Tooltip 补归因（距上次响应时长）
    const detailParts = [
        cacheStatus.contextTokens !== undefined && t('session.cacheStatus.recache', { tokens: formatTokens(cacheStatus.contextTokens) }),
        cacheStatus.estimatedCacheWriteUsd !== undefined && t('session.cacheStatus.cost', { usd: cacheStatus.estimatedCacheWriteUsd.toFixed(2) }),
    ].filter(Boolean) as string[]
    const tooltip = cacheStatus.secondsSinceLastResponse !== undefined
        ? t('session.cacheStatus.lastResponse', { duration: formatDuration(cacheStatus.secondsSinceLastResponse * 1000) })
        : undefined

    return (
        <AppTooltip title={tooltip} mouseEnterDelay={0.3}>
            <Row data-testid="cache-expired-row">
                <WarnIcon aria-hidden="true">
                    <TriangleAlert size={14} />
                </WarnIcon>
                <span>
                    <Title>{t('session.cacheStatus.badge')}</Title>
                    {detailParts.length > 0 ? <Detail> · {detailParts.join(' · ')}</Detail> : null}
                </span>
            </Row>
        </AppTooltip>
    )
}
