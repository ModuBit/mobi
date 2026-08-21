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

import type { Transition } from 'motion/react'

/**
 * 全局 spring 动效预设——唯一来源，数值与 packages/web/DESIGN.md frontmatter 一一对应。
 * 禁止在组件里手写 bounce/duration 字面量；调气质只改这里。
 *
 * 用 motion 的 duration-based spring 参数化 (type: spring, duration, bounce)：
 * duration 为到达目标的感知时长（越短越跟手），bounce 0~1 控制过冲弹性
 * （0 无回弹，1 极弹）。
 *
 * ⚠️ 不要传 damping/stiffness：motion 里 damping 是**绝对阻尼系数**（正常值 ~20+，
 * 与 Apple 的 damping ratio 阻尼比不是一个东西），且只要出现就会覆盖 duration/bounce
 * ——曾误传 damping: 0.8（几乎无阻尼）导致所有 spring 动画多周期长震荡。
 */
export const spring = {
    /** 状态切换、开关、面板开合（默认档，轻微 overshoot；bounce 0.25 为 motion 默认弹性） */
    ui: { type: 'spring', duration: 0.35, bounce: 0.25 } satisfies Transition,
    /** 拖拽释放后的沉降（Drawer、甩动）——velocity 由调用方透传，更利落少弹 */
    momentum: { type: 'spring', duration: 0.3, bounce: 0.2 } satisfies Transition,
    /** 大面积元素（Modal 级）位移，弹跳收敛防廉价感 */
    gentle: { type: 'spring', duration: 0.5, bounce: 0.05 } satisfies Transition,
} as const
