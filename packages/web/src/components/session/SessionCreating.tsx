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
import { keyframes } from '@emotion/react'
import { MobiLogo } from '@/components/ui/MobiLogo'

/**
 * 创建会话过渡态
 *
 * NewSessionPage 的 isPending 期间替换 Sender 区域，传递"正在创建会话"的感知。
 * 后端 spawn 没有真实进度，所以这里不编造阶段、不计时——只用持续的品牌动效 +
 * 固定文案 + 流动进度条，诚实告诉用户"在等"。mount 即动，unmount 即撤，无 JS 时间状态。
 *
 * 主题：全部走 antd cssVar（var(--ant-colorXxx)）与项目 var(--font-mono)，
 * light/dark 由 antd ThemeProvider 自动切换，零硬编码颜色。
 * 动画：尊重 prefers-reduced-motion。
 */

const reducedMotion = '@media (prefers-reduced-motion: reduce)'

/* ───────────────── keyframes（emotion 全局去重） ───────────────── */

const viewInKf = keyframes`
    from { opacity: 0; transform: translateY(8px) scale(.985); filter: blur(4px); }
    to   { opacity: 1; transform: none; filter: none; }
`

const livePulseKf = keyframes`
    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ant-colorWarning) 55%, transparent); }
    70%  { box-shadow: 0 0 0 6px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
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

/** 过渡态视图：替换 Sender 区域，承担"正在创建"的仪式感 */
const View = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    padding: 56px 32px 40px;
    position: relative;
    overflow: hidden;
    min-height: 280px;
    background: var(--ant-colorBgContainer);
    border-radius: var(--ant-borderRadius, 8px);
    animation: ${viewInKf} 420ms cubic-bezier(.22, 1, .36, 1) both;

    ${reducedMotion} { animation: none; }

    @media (max-width: 640px) { padding: 40px 20px 32px; gap: 18px; }
`

/** 环境回显 chip：让用户确认"我点的就是这个目标" */
const EnvChip = styled.div`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--ant-colorFillTertiary);
    border: 1px solid var(--ant-colorBorderSecondary);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ant-colorTextSecondary);
    letter-spacing: .01em;
    max-width: 100%;

    .machine { color: var(--ant-colorText); font-weight: 500; }
    .sep     { color: var(--ant-colorTextQuaternary); }
    .path    { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .live-dot {
        width: 7px; height: 7px;
        flex-shrink: 0;
        border-radius: 50%;
        background: var(--ant-colorWarning);
        animation: ${livePulseKf} 1800ms ease-out infinite;
        ${reducedMotion} { animation: none; }
    }
`

/** 固定文案：等宽 + 暖橙闪烁光标，terminal 感 */
const Stage = styled.div`
    font-family: var(--font-mono);
    font-size: 14.5px;
    color: var(--ant-colorText);
    font-weight: 500;
    letter-spacing: .01em;
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    text-align: center;

    .cursor {
        display: inline-block;
        width: .55em;
        margin-left: 3px;
        color: var(--ant-colorWarning);
        animation: ${blinkKf} 1000ms steps(2, start) infinite;
        ${reducedMotion} { animation: none; opacity: .6; }
    }
`

const Sub = styled.div`
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--ant-colorTextTertiary);
    margin-top: -10px;
    text-align: center;
`

/** indeterminate 流动进度条：不假装有真实进度，只传递"在流动" */
const Progress = styled.div`
    width: 220px;
    height: 3px;
    border-radius: 999px;
    background: var(--ant-colorBorder);
    overflow: hidden;
    position: relative;
    margin-top: 6px;

    &::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg,
            transparent 0%,
            var(--ant-colorText) 30%,
            var(--ant-colorWarning) 50%,
            var(--ant-colorText) 70%,
            transparent 100%);
        background-size: 200% 100%;
        animation: ${flowKf} 1500ms cubic-bezier(.4, 0, .2, 1) infinite;
        opacity: .85;
        ${reducedMotion} { animation: none; opacity: .45; }
    }

    @media (max-width: 640px) { width: 180px; }
`

export interface SessionCreatingProps {
    /** 机器显示名（displayName → host → id.slice，见 NewSessionPage.machineLabel） */
    machineLabel: string
    /** 工作目录（已格式化，home 被替换为 ~） */
    directory: string
}

/**
 * 创建会话过渡态视图
 *
 * mount 时机即 isPending 起始，MobiLogo 的「小跳三下」正好在显示时循环播放。
 * 纯展示组件，无任何时间状态——进度条与光标是 CSS 动画循环，不基于真实进度推导。
 */
export function SessionCreating({ machineLabel, directory }: SessionCreatingProps) {
    const { t } = useTranslation()

    return (
        <View>
            <EnvChip>
                <span className="live-dot" />
                <span className="machine">{machineLabel}</span>
                <span className="sep">·</span>
                <span className="path">{directory || '/'}</span>
            </EnvChip>

            <MobiLogo size={64} style={{ marginTop: 4, marginBottom: -6 }} />

            {/* role=status：mount 时由屏幕阅读器播报一次"正在创建会话…"；装饰元素 aria-hidden */}
            <Stage role="status" aria-live="polite">
                {t('newSession.spawnStage.creating')}
                <span className="cursor" aria-hidden="true">▍</span>
            </Stage>
            <Sub>{t('newSession.spawnStage.creatingSub')}</Sub>

            <Progress aria-hidden="true" />
        </View>
    )
}
