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

/**
 * Mobi 品牌动画组件（公共）—— 「小跳三下」。
 *
 * 角色叙事：logo 的 m 标记是一只小兽——两条竖线是脸颊、顶部圆弧钩是耳朵、
 * 中间墨点是鼻头。动画：兴奋地原地小跳三下（一跳比一跳矮，落地轻压扁），
 * 鼻头惯性拖拽，然后静止聆听一拍。
 *
 * play 两种播放方式，动画是同一个动作：
 * - 'loop'（默认）：无限循环 —— loading / 等待场景（创建会话过渡、全局 pending 等）
 * - 'once'：播一轮后定格 —— 入场打招呼场景（登录页品牌亮相等）
 *
 * 实现约束：动画全部是 CSS transform（translateY / scale），logo path 几何
 * 原封不动——零 path 形变、零接缝。transform-origin 以底部基线为轴
 * （scaleY 压扁不悬浮），鼻头反向位移制造 Q 弹惯性感。
 *
 * 颜色跟随 app 主题；prefers-reduced-motion 时完全静止。
 * 装饰性标记（aria-hidden）：语义由调用方文案承载（如 role=status）。
 */

import type { CSSProperties } from 'react'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { useUiStore } from '@/core/data/stores/uiStore'
import { MOBI_MARK_PATH } from '@/components/layout/brandPaths'

/** 播放方式：loop=无限循环（等待）；once=播一轮定格（入场） */
export type MobiLogoPlay = 'loop' | 'once'

interface MobiLogoProps {
    /** 播放方式，默认 'loop' */
    play?: MobiLogoPlay
    /** 边长（正方形），默认 64 */
    size?: number
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

const reducedMotion = '@media (prefers-reduced-motion: reduce)'

/* ── keyframes（emotion 全局去重） ── */

/** 整脸小跳三下：蹲 → 腾空 → 落地压扁 ×3（一跳比一跳矮），40% 后静止聆听 */
const faceHopKf = keyframes`
    0%        { transform: translateY(0) scale(1, 1); }
    4%        { transform: translateY(2px) scale(1.03, .95); }
    10%       { transform: translateY(-12px) scale(.98, 1.04); }
    16%       { transform: translateY(0) scale(1.05, .93); }
    20%       { transform: translateY(-9px) scale(.99, 1.02); }
    25%       { transform: translateY(0) scale(1.04, .94); }
    29%       { transform: translateY(-6px) scale(1, 1); }
    33%       { transform: translateY(0) scale(1.03, .96); }
    40%, 100% { transform: translateY(0) scale(1, 1); }
`

/** 鼻头惯性：与整脸反向拖拽（跳起滞后下沉、落地回弹上浮），制造 Q 弹感 */
const noseInertiaKf = keyframes`
    0%        { transform: translateY(0); }
    6%        { transform: translateY(3px); }
    12%       { transform: translateY(-4px); }
    16%       { transform: translateY(2px); }
    22%       { transform: translateY(-2px); }
    28%       { transform: translateY(1px); }
    34%, 100% { transform: translateY(0); }
`

/* ── 作用域样式 ── */

/**
 * 整脸（双耳 + 鼻头共用跳跳动画）：origin 锚定底部基线，压扁不悬浮。
 * 播放次数/定格（play）走 inline style——inline 优先级高于样式表，
 * 且 jsdom getComputedStyle 只算 inline，可测。
 */
const Face = styled.g`
    transform-box: view-box;
    transform-origin: 125px 183px;
    animation: ${faceHopKf} 2400ms cubic-bezier(.36, 0, .64, 1);

    ${reducedMotion} { animation: none; }
`

/** 鼻头惯性拖拽（与整脸同一播放方式） */
const Nose = styled.circle`
    transform-box: fill-box;
    transform-origin: center;
    animation: ${noseInertiaKf} 2400ms cubic-bezier(.36, 0, .64, 1);

    ${reducedMotion} { animation: none; }
`

/** play → inline 播放控制：once 播 1 轮 forwards 定格（末帧=初始姿态，定格自然）；loop 无限 */
function playStyle(play: MobiLogoPlay): CSSProperties {
    return play === 'once'
        ? { animationIterationCount: 1, animationFillMode: 'forwards' }
        : { animationIterationCount: 'infinite' }
}

export function MobiLogo({ play = 'loop', size = 64, className, style }: MobiLogoProps) {
    const isDark = useUiStore((s) => s.theme === 'dark')
    const color = isDark ? '#faf9f5' : '#141413'
    const playProps = { style: playStyle(play) }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 250 250"
            width={size}
            height={size}
            className={className}
            style={{ ...style, color }}
            aria-hidden="true"
        >
            <Face fill="currentColor" {...playProps}>
                {/* 左脸颊 + 左耳（整体 mark） */}
                <path d={MOBI_MARK_PATH} />
                {/* 右侧镜像（独立一层承载 attribute transform，避免被 CSS 动画覆盖） */}
                <g transform="translate(250,0) scale(-1,1)">
                    <path d={MOBI_MARK_PATH} />
                </g>
                {/* 鼻头 */}
                <Nose cx="125" cy="161" r="16.5" {...playProps} />
            </Face>
        </svg>
    )
}
