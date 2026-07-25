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

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'

/**
 * 命令执行中进度 bubble（compact / clear 等共用）
 *
 * 聊天流里的进行中反馈。后端命令（/compact、/clear）无真实进度，这里不编造百分比、
 * 不计时——用 图标 + 固定文案 + 暖橙闪烁光标 + indeterminate 流动进度条，诚实传递
 * "命令在跑"。与 SessionSpawnPending 共用同一套流动条视觉语言。
 *
 * 主题：全部 antd cssVar + 项目 var(--font-mono)，light/dark 自动，零硬编码。
 * 动画：尊重 prefers-reduced-motion。
 */

const reducedMotion = '@media (prefers-reduced-motion: reduce)'

/* ───────────────── keyframes ───────────────── */

const cardInKf = keyframes`
    from { opacity: 0; transform: translateY(6px) scale(.98); }
    to   { opacity: 1; transform: none; }
`

const blinkKf = keyframes`
    0%, 50%      { opacity: 1; }
    50.01%, 100% { opacity: 0; }
`

const flowKf = keyframes`
    0%   { background-position: 100% 0; }
    100% { background-position: -100% 0; }
`

/* ───────────────── styled ───────────────── */

/** 卡片容器：浅底圆角，min-width 保证进度条可见 */
const Card = styled.div`
    background: var(--ant-colorBgElevated);
    border: 1px solid var(--ant-colorBorderSecondary);
    border-radius: var(--ant-borderRadiusLG, 14px);
    padding: 14px 16px;
    min-width: 240px;
    box-shadow: var(--ant-boxShadowSecondary, none);
    animation: ${cardInKf} 360ms cubic-bezier(.22, 1, .36, 1) both;

    ${reducedMotion} { animation: none; }
`

const Row = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
`

/** 图标软底（暖橙 tint），与进度条高亮呼应 */
const IconBox = styled.span`
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--ant-colorWarning) 14%, transparent);
    color: var(--ant-colorWarning);

    svg { width: 16px; height: 16px; }
`

const Title = styled.span`
    font-family: var(--font-mono);
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ant-colorText);
    letter-spacing: .01em;
    display: inline-flex;
    align-items: center;

    .cursor {
        display: inline-block;
        width: .5em;
        margin-left: 3px;
        color: var(--ant-colorWarning);
        animation: ${blinkKf} 1000ms steps(2, start) infinite;
        ${reducedMotion} { animation: none; opacity: .6; }
    }
`

/** indeterminate 流动进度条：不假装有真实进度 */
const Progress = styled.div`
    width: 100%;
    height: 3px;
    border-radius: 999px;
    background: var(--ant-colorBorder);
    overflow: hidden;
    position: relative;

    &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg,
            transparent 0%,
            var(--ant-colorTextTertiary) 30%,
            var(--ant-colorWarning) 50%,
            var(--ant-colorTextTertiary) 70%,
            transparent 100%);
        background-size: 200% 100%;
        animation: ${flowKf} 1500ms cubic-bezier(.4, 0, .2, 1) infinite;
        opacity: .85;
        ${reducedMotion} { animation: none; opacity: .45; }
    }
`

export interface CommandProgressBubbleProps {
    /** 命令图标（如 CompressOutlined / ClearOutlined） */
    icon: ReactNode
    /** 文案 i18n key（如 chat.compacting / chat.clearing） */
    titleKey: string
}

/**
 * 命令执行中进度 bubble
 *
 * 由 ChatContainer 在 /compact、/clear 等命令进行中 push 到聊天流末尾。
 * 纯展示组件，无时间状态——进度条与光标是 CSS 动画循环。
 */
export function CommandProgressBubble({ icon, titleKey }: CommandProgressBubbleProps) {
    const { t } = useTranslation()

    return (
        <Card>
            <Row>
                <IconBox>{icon}</IconBox>
                {/* role=status：文案 mount 时由屏幕阅读器播报一次；装饰元素 aria-hidden */}
                <Title role="status" aria-live="polite">
                    {t(titleKey)}
                    <span className="cursor" aria-hidden="true">▍</span>
                </Title>
            </Row>
            <Progress aria-hidden="true" />
        </Card>
    )
}
