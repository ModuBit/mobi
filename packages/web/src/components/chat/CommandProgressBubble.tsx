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

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { PixelLoader } from '@/components/ui/PixelLoader'
import { useElapsedSeconds } from './useElapsedSeconds'
import { formatElapsedTime } from '@/core/utils/timeFormat'

/**
 * 命令执行中进度 bubble（compact / clear 等共用）
 *
 * 聊天流里的进行中反馈。后端命令（/compact、/clear）无真实进度，这里不编造百分比。
 *
 * 形态是「系统动作行」——与组头/状态栏同一视觉词汇（PixelLoader 波形 + mono 小字 +
 * shimmer 扫光），无边框/阴影/大 Logo 的贴片卡已废弃：聊天流的语言是无边框轻行，
 * 卡片形态视觉重量是周围行的数倍，像 toast 长在了消息流里（2026-09-20 mockup 评审）。
 * 波形用 orbit（彗星绕圈）：命令进行中无事件推进，「有事在转」的语义比 drive 的
 * 「波前推进」更诚实。
 *
 * 主题：全部 antd cssVar + 项目 var(--font-mono)，light/dark 自动，零硬编码。
 * 动画：shimmer/PixelLoader 均自带 prefers-reduced-motion 处理（base.css）。
 */

const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 0;
`

const Title = styled.span`
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--ant-color-text);
    letter-spacing: .01em;
`

const Elapsed = styled.span`
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ant-color-text-tertiary);
`

export interface CommandProgressBubbleProps {
    /** 文案 i18n key（如 chat.compacting / chat.clearing） */
    titleKey: string
}

/**
 * 命令执行中进度 bubble
 *
 * 由 ChatContainer 在 /compact、/clear 等命令进行中 push 到聊天流末尾。
 * 计时以组件 mount 时刻为起点——bubble 在命令开始时入列，mount ≈ 命令起点
 * （刷新后重挂重新计时，与 AgentLoadingBubble 的 mount 兜底同款取舍）。
 */
export function CommandProgressBubble({ titleKey }: CommandProgressBubbleProps) {
    const { t } = useTranslation()
    // mount ≈ 命令起点（见上）；秒级 tick 驱动计时刷新
    const startedAtRef = useRef(Date.now())
    // hook 调用承载秒级 tick；formatElapsedTime 缺省 now 即可，不必从秒回合成 ms 时间戳
    useElapsedSeconds(startedAtRef.current)
    const elapsedTime = formatElapsedTime(startedAtRef.current)

    return (
        <Row>
            {/* role=status：文案 mount 时由屏幕阅读器播报一次；装饰元素 aria-hidden */}
            <Title role="status" aria-live="polite" className="shimmer-text">
                {t(titleKey)}
            </Title>
            <Elapsed>{elapsedTime}</Elapsed>
            {/* PixelLoader 自带 aria-hidden */}
            <PixelLoader variant="orbit" />
        </Row>
    )
}
