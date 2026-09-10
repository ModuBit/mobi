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
 * 像素网格加载器（参考 beautifului.dev Loading State）。
 * 格子样式与动画收在 base.css 的 .pixel-loader-cell（颜色走 currentColor 分层，
 * 深浅主题天然自适应）；波形模式固化在本组件，消费方按状态语义选波形：
 *
 * - drive：chevron 波前从左向右推进（650ms）——「持续推进」，运行中
 * - dots：同 drive 波形的圆形格——「持续推进」的柔和变体
 * - orbit：彗星绕外圈环绕（950ms），中心格静止——「有事在转但无进展」，停滞/等待回合
 * - twinkle：星空低频眨眼（5s 周期，任一时刻平均 <1 颗亮）——「活着但闲置」，空闲
 * - ghost：全静止暗格——「在场但已关闭」
 *
 * 逐实例差异（尺寸/颜色/相位）全部经容器承载（CSS 类 / color / --phase 变量），
 * 格子元素树按变体提升到模块级——重渲染时 React 直接跳过子树 reconcile。
 */

export type PixelVariant = 'drive' | 'dots' | 'orbit' | 'twinkle' | 'ghost'

/** chevron 波形 delay：(列 + |行-1|) × 90ms——中间行先亮，向两侧/右下扩散成箭头波前 */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) =>
    ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90,
)

/** orbit 环绕序：外圈按顺时针 110ms 错峰，中心格（不在序中）静止暗态 */
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const ORBIT_DELAYS = Array.from({ length: 9 }, (_, i) => {
    const k = ORBIT_ORDER.indexOf(i)
    return k === -1 ? null : k * 110
})

/**
 * twinkle 眨眼格：9 格中让 6 格带动画（间隔分布 + 5s 内错峰），其余 3 格静止基线。
 * delay 取负值 = 动画在挂载瞬间已进行到各自中段——初始亮度/首眨时间天然随机（正 delay
 * 会在等待期露出满色基线且迟迟不闪）。
 * 眨眼**位置**也按 phase 旋转（9 棵预生成树的掩码轮转）：每行眨眼位置各不相同，
 * 「随机游走」由位置轮转 + 负 delay 中段起步 + 行间 phase 三层叠加。
 * 6/9 是随机感与常驻合成器动画数的折中（全 9 格对几十行空闲列表是 3 倍级开销）。
 */
const TWINKLE_ACTIVE_INDEXES = [0, 2, 3, 5, 7, 8]
const TWINKLE_DELAYS = [0.5, 1.4, 2.3, 2.9, 3.8, 4.6]

/** 9 棵 twinkle 树：ACTIVE_INDEXES 掩码按 offset 轮转——phase ∈ [0,5) 线性映射选树，行间位置互异 */
const TWINKLE_TREES: ReactNode[][] = Array.from({ length: 9 }, (_, offset) => {
    const delays = TWINKLE_DELAYS.map((d, i) => ({ index: (TWINKLE_ACTIVE_INDEXES[i] + offset) % 9, delay: d }))
    const byIndex = new Map(delays.map(({ index, delay }) => [index, delay]))
    return Array.from({ length: 9 }, (_, index) => {
        const delay = byIndex.get(index)
        return delay === undefined
            ? <span key={index} className="pixel-loader-cell pixel-loader-cell-idle" />
            : (
                <span
                    key={index}
                    className="pixel-loader-cell"
                    style={{
                        animationName: 'pixel-twinkle',
                        animationDuration: '5s',
                        animationDelay: `calc(var(--phase, 0s) - ${delay}s)`,
                    }}
                />
            )
    })
})

function twinkleTree(phase: number): ReactNode[] {
    return TWINKLE_TREES[Math.floor((phase / 5) * 9) % 9]
}

function ghostTree(phase: number): ReactNode[] {
    return GHOST_TREES[Math.floor((phase / 5) * 9) % 9]
}

/**
 * ghost 树：与 twinkle 同一套 6 格位置轮转，但**静态**——每格一个固定伪随机不透明度
 * （0.16~0.40，如熄灭屏幕上的残影），其余 3 格 idle 暗态；同一 sessionId 恒同一幅。
 */
const GHOST_OPACITIES = [0.32, 0.16, 0.4, 0.22, 0.36, 0.18]
const GHOST_TREES: ReactNode[][] = Array.from({ length: 9 }, (_, offset) => {
    const lit = TWINKLE_DELAYS.map((_, i) => ({ index: (TWINKLE_ACTIVE_INDEXES[i] + offset) % 9, opacity: GHOST_OPACITIES[i] }))
    const byIndex = new Map(lit.map(({ index, opacity }) => [index, opacity]))
    return Array.from({ length: 9 }, (_, index) => {
        const opacity = byIndex.get(index)
        return opacity === undefined
            ? <span key={index} className="pixel-loader-cell pixel-loader-cell-idle" />
            : <span key={index} className="pixel-loader-cell pixel-loader-cell-ghost" style={{ opacity }} />
    })
})

function buildWaveCells(delays: number[], round: boolean): ReactNode[] {
    return delays.map((delay, index) => (
        <span
            key={index}
            className="pixel-loader-cell"
            style={{ animationDelay: `${delay}ms`, borderRadius: round ? '50%' : 1 }}
        />
    ))
}

const CELLS: Record<Exclude<PixelVariant, 'twinkle'>, ReactNode[]> = {
    // drive/dots 不内联时长：650ms 由 .pixel-loader-cell 的 CSS 默认独占
    drive: buildWaveCells(CHEVRON_DELAYS, false),
    dots: buildWaveCells(CHEVRON_DELAYS, true),
    orbit: ORBIT_DELAYS.map((delay, index) => (
        delay === null
            // 中心格静止暗态（无动画）
            ? <span key={index} className="pixel-loader-cell pixel-loader-cell-idle" />
            : <span key={index} className="pixel-loader-cell" style={{ animationDelay: `${delay}ms`, animationDuration: '950ms' }} />
    )),
    ghost: GHOST_TREES[0],
}

export function PixelLoader({
    variant = 'drive',
    size = 4,
    color,
    phase = 0,
    style,
}: {
    variant?: PixelVariant
    /** 格子边长（px），会话列表等密集场景用小格（如 3）；gap 按比例缩放。缺省 4 */
    size?: number
    /** 覆盖格色（默认继承环境文字色）；语义例外色（如审批橙）由此传入 */
    color?: string
    /** twinkle 行间错相（秒）——从会话 id 派生，避免多行同 delay 锁步齐闪 */
    phase?: number
    style?: CSSProperties
}) {
    return (
        <span
            aria-hidden
            /* variant 作 key：切换波形时强制重挂载格子树。动画属性在复用节点上原地改动
               会让浏览器把已流逝时间重映射进新周期（表现为「快进」），重挂载则从 delay 0 干净起步 */
            key={variant}
            className={`pixel-loader pixel-loader-${variant}`}
            style={{ color, '--phase': `${phase}s`, '--pixel-cell': `${size}px`, ...style } as CSSProperties}
        >
            {variant === 'twinkle' ? twinkleTree(phase) : variant === 'ghost' ? ghostTree(phase) : CELLS[variant]}
        </span>
    )
}
