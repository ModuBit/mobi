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

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/** 淡入/淡出时长（单点来源：动画字符串与旧层清理定时器均由此派生） */
const FADE_MS = 200

/**
 * 文案切换 crossfade：新文案淡入、旧文案淡出（FADE_MS）。
 * 旧文案以绝对定位叠底淡出，不占布局（高度由当前文案决定，避免撑动）；
 * wrapper overflow:hidden 裁剪旧层——旧文案比新文案宽时不溢出压到相邻 UI。
 * 内层 span 以文案为 key，文案变化即重挂载重启淡入动画。
 * shimmer=true 时叠加微光扫过（运行态强调，如折叠组动态标题）——动画整体由
 * base.css 的 .crossfade-text / .shimmer-text 类承载，--fade-ms 注入淡入时长。
 * 旧层在 paint 前（useLayoutEffect）就位，避免「先消失一帧再闪回淡出」；
 * 定时器清理旧层（jsdom 无 AnimationEvent，onAnimationEnd 不可测/不可靠），
 * effect cleanup 负责清 timer——连续快速变化时旧层被最新一次替换、定时器自动重置。
 */
export function CrossfadeText({ text, style, shimmer, ellipsis }: { text: string; style?: CSSProperties; shimmer?: boolean; ellipsis?: boolean }) {
    // ellipsis 前置条件：父级必须是块级（或有确定宽度）的容器——maxWidth:100% 相对
    // containing block 解引用，父级是 shrink-to-fit 的 inline/flex 内容时恒不触发，
    // 长文案会撑破布局而非省略（如 antd.css 中 .tool-call-think 的收缩链）
    const [leaving, setLeaving] = useState<string | null>(null)
    const prevTextRef = useRef(text)

    useLayoutEffect(() => {
        if (prevTextRef.current === text) return
        setLeaving(prevTextRef.current)
        prevTextRef.current = text
        const timer = setTimeout(() => setLeaving(null), FADE_MS)
        return () => clearTimeout(timer)
    }, [text])

    return (
        <span
            style={{
                position: 'relative',
                display: 'inline-flex',
                overflow: 'hidden',
                ...style,
            }}
        >
            <span
                key={text}
                className={shimmer ? 'crossfade-text shimmer-text' : 'crossfade-text'}
                style={{
                    '--fade-ms': `${FADE_MS}ms`,
                    // 省略四件套整体收在 ellipsis 分支：默认路径保持不受限的 crossfade 形状
                    ...(ellipsis && {
                        maxWidth: '100%',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }),
                } as CSSProperties}
            >
                {text}
            </span>
            {leaving != null && (
                <span
                    aria-hidden
                    style={{
                        position: 'absolute',
                        inset: 0,
                        animation: `crossfade-out ${FADE_MS}ms ease forwards`,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {leaving}
                </span>
            )}
        </span>
    )
}
