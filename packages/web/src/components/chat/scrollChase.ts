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
 * 平滑追赶的共享单帧步进（useStickToBottom 主列表 / useSmoothStickBottom
 * thinking 内容盒共用）。守卫集合与 rAF 生命周期由各 hook 自持——它们语义
 * 不同（主列表有跟随意图/门闩/拖拽守卫，小容器只有 enabled）；这里只收敛
 * 必须同步演进的核心机制：缓动数学、精确贴底、外部干预检测。
 */

/**
 * 追赶缓动：每帧追掉「距底部剩余距离」的比例。
 *
 * 流式内容增高（换行/新增块）不再瞬跳（`scrollTop = scrollHeight` 一行高度直落），
 * 而是指数缓动追赶——一行 ~22px 约 8 帧（~130ms）平滑滚下，快输出/窄屏下
 * 持续增高的场景列表平滑跟随而非一跳一跳。
 */
export const CHASE_EASE = 0.25

/** 距底 ≤ 此像素直接贴齐（精确收敛：turn 结束 finalDist === 0） */
export const CHASE_SNAP_PX = 1

export interface ChaseStepResult {
    /** true = 追赶结束（收敛或被外部干预中止），不再排下一帧 */
    done: boolean
    /** 因外部干预中止（上一帧设置的 scrollTop 被别人改动）——调用方据此让位/补追 */
    aborted: boolean
    /** 下一帧的外部干预检测基准（写后读回）；done 时为 null */
    expectedTop: number | null
}

/**
 * 执行一帧追赶步进：
 * - 外部干预检测：上一帧设置的值被改动（prepend 恢复补偿 / 浏览器 clamp）→ 中止让位
 * - 距底 ≤ {@link CHASE_SNAP_PX}（含 0 / 内容收缩的负值）→ 精确贴底收敛
 * - 否则追掉剩余距离的 {@link CHASE_EASE}
 *
 * 期望值一律「写后读回」：浏览器会把 scrollTop snap 到物理像素网格
 * （DPR 2 时 0.5px 粒度），存浮点计算值会下一帧误判「外部干预」而中止。
 */
export function chaseStep(el: HTMLElement, expectedTop: number | null): ChaseStepResult {
    if (expectedTop !== null && el.scrollTop !== expectedTop) {
        return { done: true, aborted: true, expectedTop: null }
    }
    const bottom = el.scrollHeight - el.clientHeight
    const dist = bottom - el.scrollTop
    if (dist <= CHASE_SNAP_PX) {
        el.scrollTop = bottom
        return { done: true, aborted: false, expectedTop: null }
    }
    el.scrollTop += dist * CHASE_EASE
    return { done: false, aborted: false, expectedTop: el.scrollTop }
}
