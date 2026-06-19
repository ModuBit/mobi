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
 * Mobi 动画 Logo 组件 — 内联 SVG，支持 currentColor 继承父元素颜色，
 * 自动适配深浅主题。包含层叠构建、呼吸脉冲、浮动和扫描线动画。
 */

import type { CSSProperties } from 'react'

interface AnimateLogoProps {
    /** 自定义类名 */
    className?: string
    /** 内联样式 */
    style?: CSSProperties
}

/**
 * Mobi 动画 Logo，使用 currentColor 继承父元素颜色。
 * 父元素设置 `color` 即可控制 Logo 颜色。
 */
export function AnimateLogo({ className, style }: AnimateLogoProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 128 128"
            fill="none"
            role="img"
            aria-label="Mobi"
            className={className}
            style={style}
        >
            <style>{`
                .al-logo {
                    transform-origin: center;
                    animation: al-float 2800ms ease-in-out infinite;
                    animation-delay: 1500ms;
                }

                .al-layer1 {
                    opacity: 0;
                    animation: al-build1 800ms cubic-bezier(.22,1,.36,1) forwards;
                }

                .al-layer2 {
                    opacity: 0;
                    animation: al-build2 800ms cubic-bezier(.22,1,.36,1) forwards;
                    animation-delay: 250ms;
                }

                .al-layer3 {
                    opacity: 0;
                    animation: al-build3 800ms cubic-bezier(.22,1,.36,1) forwards;
                    animation-delay: 500ms;
                }

                .al-dot {
                    opacity: 0;
                    animation: al-dotAppear 500ms ease forwards, al-pulse 2800ms ease-in-out infinite;
                    animation-delay: 900ms, 1500ms;
                }

                .al-scan {
                    stroke-dasharray: 8 54;
                    stroke-dashoffset: 0;
                    animation: al-scan 2400ms linear infinite;
                    animation-delay: 1500ms;
                }

                @media (prefers-reduced-motion: reduce) {
                    .al-logo,
                    .al-dot,
                    .al-scan {
                        animation: none !important;
                    }
                    .al-layer1 { animation: al-build1 800ms cubic-bezier(.22,1,.36,1) forwards !important; }
                    .al-layer2 { animation: al-build2 800ms cubic-bezier(.22,1,.36,1) forwards !important; }
                    .al-layer3 { animation: al-build3 800ms cubic-bezier(.22,1,.36,1) forwards !important; }
                    .al-dot { animation: al-dotAppear 500ms ease forwards !important; animation-delay: 900ms !important; }
                }

                @keyframes al-build1 {
                    from { opacity: 0; transform: translateY(20px) scaleY(.6); }
                    to { opacity: 1; transform: translateY(0) scaleY(1); }
                }

                @keyframes al-build2 {
                    from { opacity: 0; transform: translateY(20px) scaleY(.6); }
                    to { opacity: .16; transform: translateY(0) scaleY(1); }
                }

                @keyframes al-build3 {
                    from { opacity: 0; transform: translateY(20px) scaleY(.6); }
                    to { opacity: .08; transform: translateY(0) scaleY(1); }
                }

                @keyframes al-dotAppear {
                    from { opacity: 0; transform: scale(.6); }
                    to { opacity: 1; transform: scale(1); }
                }

                @keyframes al-pulse {
                    0% { transform: scale(1); }
                    20% { transform: scale(1.15); }
                    40% { transform: scale(1); }
                    100% { transform: scale(1); }
                }

                @keyframes al-float {
                    0% { transform: translateY(0); }
                    25% { transform: translateY(-3px); }
                    50% { transform: translateY(0); }
                    100% { transform: translateY(0); }
                }

                @keyframes al-scan {
                    from { stroke-dashoffset: 0; }
                    to { stroke-dashoffset: -62; }
                }
            `}</style>

            <g className="al-logo" fill="currentColor">
                {/* Layer 3 */}
                <rect
                    className="al-layer3"
                    x="57"
                    y="17"
                    width="29"
                    height="78"
                    rx="15"
                    opacity=".08"
                />

                {/* Layer 2 */}
                <rect
                    className="al-layer2"
                    x="50"
                    y="11"
                    width="29"
                    height="78"
                    rx="15"
                    opacity=".16"
                />

                {/* Layer 1 */}
                <rect
                    className="al-layer1"
                    x="43"
                    y="5"
                    width="29"
                    height="78"
                    rx="15"
                />

                {/* Hollow Dot */}
                <g transform="translate(57.5 114)">
                    <g className="al-dot">
                        <circle
                            r="9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3.5"
                        />
                        <circle
                            className="al-scan"
                            r="9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            opacity=".5"
                        />
                    </g>
                </g>
            </g>
        </svg>
    )
}
