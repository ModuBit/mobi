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
 * 禁止在组件里手写 damping/duration 字面量；调气质只改这里。
 *
 * motion 的 (type: spring, damping, duration) 即 Apple (damping ratio, response) 参数化：
 * damping < 1 带 overshoot，duration 越小越跟手（非固定时长，settle 时间由参数涌现）。
 */
export const spring = {
    /** 状态切换、开关、面板开合（默认档，轻微 overshoot） */
    ui: { type: 'spring', damping: 0.8, duration: 0.35 } satisfies Transition,
    /** 拖拽释放后的沉降（Drawer、甩动）——velocity 由调用方透传 */
    momentum: { type: 'spring', damping: 0.75, duration: 0.3 } satisfies Transition,
    /** 大面积元素（Modal 级）位移，弹跳收敛防廉价感 */
    gentle: { type: 'spring', damping: 0.9, duration: 0.5 } satisfies Transition,
} as const
