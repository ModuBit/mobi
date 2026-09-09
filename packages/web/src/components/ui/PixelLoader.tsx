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

import type { CSSProperties } from 'react'

/**
 * 像素网格加载器（参考 beautifului.dev Loading State）：
 * 3×3 像素块按 chevron 波形从左向右依次点亮，表达「持续推进」。
 * 颜色用 --ant-color-text + opacity 分层，深浅主题天然自适应；
 * 动画 keyframes（pixel-on）定义在 base.css。
 */

/** chevron 波形 delay：(列 + |行-1|) × 90ms——中间行先亮，向两侧/右下扩散成箭头波前 */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) =>
    ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90,
)

export function PixelLoader({ style }: { style?: CSSProperties }) {
    return (
        <span
            aria-hidden
            className="pixel-loader"
            style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 4px)', gap: 1.5, flexShrink: 0, ...style }}
        >
            {CHEVRON_DELAYS.map((delay, index) => (
                <span
                    key={index}
                    className="pixel-loader-cell"
                    style={{
                        width: 4,
                        height: 4,
                        borderRadius: 1,
                        background: 'var(--ant-color-text)',
                        animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
                    }}
                />
            ))}
        </span>
    )
}
