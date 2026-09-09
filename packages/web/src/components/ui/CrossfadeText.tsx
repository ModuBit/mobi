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

import { useEffect, useRef, useState, type CSSProperties } from 'react'

/** 旧文案淡出时长（与 group-title-fade-out 动画时长一致） */
const LEAVE_MS = 200

/**
 * 文案切换 crossfade：新文案淡入、旧文案淡出（~200ms）。
 * 旧文案以绝对定位叠底淡出，不占布局（高度由当前文案决定，避免撑动）。
 * 旧层用定时器清理（jsdom 无 AnimationEvent，onAnimationEnd 不可测/不可靠）。
 * 连续快速变化时旧层直接被最新一次切换替换，不累积。
 * 用于折叠组组头等文案高频动态更新的场景。
 */
export function CrossfadeText({ text, style }: { text: string; style?: CSSProperties }) {
    const [display, setDisplay] = useState(text)
    const [leaving, setLeaving] = useState<string | null>(null)
    const prevTextRef = useRef(text)

    useEffect(() => {
        if (prevTextRef.current === text) return
        setLeaving(prevTextRef.current)
        setDisplay(text)
        prevTextRef.current = text
    }, [text])

    useEffect(() => {
        if (leaving == null) return
        const timer = setTimeout(() => setLeaving(null), LEAVE_MS)
        return () => clearTimeout(timer)
    }, [leaving])

    return (
        <span style={{ position: 'relative', display: 'inline-flex', ...style }}>
            <span key={display} style={{ animation: 'group-title-fade-in 200ms ease' }}>{display}</span>
            {leaving != null && (
                <span
                    aria-hidden
                    style={{
                        position: 'absolute',
                        inset: 0,
                        animation: 'group-title-fade-out 200ms ease forwards',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {leaving}
                </span>
            )}
        </span>
    )
}
