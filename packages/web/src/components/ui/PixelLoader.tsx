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

/** 相位空间（秒）：既是 twinkle 的动画周期，也是 phase→树索引映射的区间上界——
 *  两处共用本常量，改周期不会让树分布静默偏斜 */
const PHASE_PERIOD_S = 5
const TREE_COUNT = 9

/** twinkle 眨眼 / ghost 残影共用的 6 个活跃槽位（9 格中间隔分布），
 *  6/9 是随机感与常驻合成器动画数的折中（全 9 格对几十行空闲列表是 3 倍级开销） */
const ACTIVE_SLOTS = [0, 2, 3, 5, 7, 8]

/**
 * 逐槽位属性，均以槽位序为键（与 ACTIVE_SLOTS 一一对应）：
 * - SLOT_DELAYS：twinkle 眨眼 delay（秒），负 delay = 挂载即动画中段——初始亮度/首眨
 *   时间天然随机（正 delay 会在等待期露出满色基线且迟迟不闪）
 * - SLOT_OPACITIES：ghost 残影不透明度（0.16~0.40，如熄灭屏幕上的暗格）
 * 「随机游走」由位置轮转 + 负 delay 中段起步 + 行间 phase 三层叠加。
 */
const SLOT_DELAYS = [0.5, 1.4, 2.3, 2.9, 3.8, 4.6]
const SLOT_OPACITIES = [0.32, 0.16, 0.4, 0.22, 0.36, 0.18]

/** phase（∈ [0, PHASE_PERIOD_S)）→ 树索引：线性映射到 TREES_COUNT 棵预生成树 */
function treeIndex(phase: number): number {
    return Math.floor((phase / PHASE_PERIOD_S) * TREE_COUNT) % TREE_COUNT
}

/**
 * 9 棵相位树（twinkle/ghost 共用脚手架）：槽位掩码按 offset 轮转，phase 选树——
 * 行间眨眼/残影位置互异，同一 sessionId 恒同一幅。
 * renderLit(index, slot) 渲染一个活跃格：index 是 3×3 网格中的位置，slot 是
 * 槽位序（查 SLOT_DELAYS / SLOT_OPACITIES）；非槽位格为静止暗态。
 */
function buildPhaseTrees(renderLit: (index: number, slot: number) => ReactNode): ReactNode[][] {
    return Array.from({ length: TREE_COUNT }, (_, offset) => {
        const slotOf = new Map(ACTIVE_SLOTS.map((slot, i) => [(slot + offset) % TREE_COUNT, i]))
        return Array.from({ length: TREE_COUNT }, (_, index) => {
            const slot = slotOf.get(index)
            return slot === undefined
                ? <span key={index} className="pixel-loader-cell pixel-loader-cell-idle" />
                : renderLit(index, slot)
        })
    })
}

const TWINKLE_TREES = buildPhaseTrees((index, slot) => (
    <span
        key={index}
        className="pixel-loader-cell"
        style={{
            animationName: 'pixel-twinkle',
            animationDuration: `${PHASE_PERIOD_S}s`,
            animationDelay: `calc(var(--phase, 0s) - ${SLOT_DELAYS[slot]}s)`,
        }}
    />
))

/** ghost 树：与 twinkle 同一套槽位轮转，但**静态**——每格固定伪随机不透明度（残影） */
const GHOST_TREES = buildPhaseTrees((index, slot) => (
    <span
        key={index}
        className="pixel-loader-cell pixel-loader-cell-ghost"
        style={{ opacity: SLOT_OPACITIES[slot] }}
    />
))

function buildWaveCells(delays: number[], round: boolean): ReactNode[] {
    return delays.map((delay, index) => (
        <span
            key={index}
            className="pixel-loader-cell"
            style={{ animationDelay: `${delay}ms`, borderRadius: round ? '50%' : 1 }}
        />
    ))
}

// 静态波形预构建（模块级，重渲染复用同一 ReactNode[] 引用）
const DRIVE_CELLS = buildWaveCells(CHEVRON_DELAYS, false)
const DOTS_CELLS = buildWaveCells(CHEVRON_DELAYS, true)
const ORBIT_CELLS = ORBIT_DELAYS.map((delay, index) => (
    delay === null
        // 中心格静止暗态（无动画）
        ? <span key={index} className="pixel-loader-cell pixel-loader-cell-idle" />
        : <span key={index} className="pixel-loader-cell" style={{ animationDelay: `${delay}ms`, animationDuration: '950ms' }} />
))

/** 取格树协议：静态波形忽略 phase，twinkle/ghost 按相位轮转选树——新增变体只碰本表 */
const CELLS: Record<PixelVariant, (phase: number) => ReactNode[]> = {
    // drive/dots 不内联时长：650ms 由 .pixel-loader-cell 的 CSS 默认独占
    drive: () => DRIVE_CELLS,
    dots: () => DOTS_CELLS,
    orbit: () => ORBIT_CELLS,
    twinkle: (phase) => TWINKLE_TREES[treeIndex(phase)],
    ghost: (phase) => GHOST_TREES[treeIndex(phase)],
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
    /** 相位（秒）：twinkle 行间错相 + twinkle/ghost 树轮转的种子——从会话 id 派生，
     *  避免多行同 delay 锁步齐闪；取值域 [0, PHASE_PERIOD_S) */
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
            {CELLS[variant](phase)}
        </span>
    )
}
