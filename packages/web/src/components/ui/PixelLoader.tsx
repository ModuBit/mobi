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

import type { CSSProperties, ReactNode } from 'react'

/**
 * 像素网格加载器（参考 beautifului.dev Loading State）：
 * 3×3 像素块按 chevron 波形从左向右依次点亮，表达「持续推进」。
 * 格子样式与动画收在 base.css 的 .pixel-loader-cell（颜色用 --ant-color-text
 * 分层，深浅主题天然自适应）；组件只负责布局与逐格 chevron delay。
 */

/** chevron 波形 delay：(列 + |行-1|) × 90ms——中间行先亮，向两侧/右下扩散成箭头波前 */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) =>
    ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90,
)

// 9 个格子 props 全静态，元素树提升到模块级——重渲染时 React 直接跳过子树 reconcile
const CELLS: ReactNode[] = CHEVRON_DELAYS.map((delay, index) => (
    <span key={index} className="pixel-loader-cell" style={{ animationDelay: `${delay}ms` }} />
))

export function PixelLoader({ style }: { style?: CSSProperties }) {
    return (
        <span
            aria-hidden
            className="pixel-loader"
            style={{ display: 'inline-grid', gridTemplateColumns: 'repeat(3, 4px)', gap: 1.5, flexShrink: 0, ...style }}
        >
            {CELLS}
        </span>
    )
}
