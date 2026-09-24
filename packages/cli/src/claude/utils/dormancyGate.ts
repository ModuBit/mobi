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
 * 休眠检查（Dormancy Gate，dormancy spec / CONTEXT.md「休眠检查」）：
 * 会话自动休眠（空闲超时退出）前的安全自查——「现在退出安全吗」的单一判定出口。
 *
 * 五项事实全部是会话进程本地的运行时状态，由 IdleTimer 到点回调处组装快照；
 * 任一阻塞则本轮不休眠。阻塞因素解除的复查节奏由 IdleTimer 的阻塞复查状态机承担
 * （见 idleTimer.ts enterBlocked），本模块只回答「此刻能不能走」。
 *
 * 用户交互（点审批、发消息等）不走这里——它们经 IdleTimer.reset 重置空闲计时，
 * 语义是「重新等一个完整空闲期」，与 gate 正交。
 */

/** 五项运行时事实（全部来自会话进程本地，禁止引入跨进程查询——已否决 hub 订阅者项） */
export interface DormancyFacts {
    /** 待处理的权限审批数 */
    pendingPermissions: number
    /** 排队未发消息数 */
    queuedMessages: number
    /** turn 正在运行 */
    turnRunning: boolean
    /** 存活终端（PTY）数 */
    liveTerminals: number
    /** 存活后台任务数 */
    backgroundTasks: number
}

export type DormancyBlocker =
    | 'pending_permissions'
    | 'queued_messages'
    | 'turn_running'
    | 'live_terminals'
    | 'background_tasks'

/**
 * 休眠判定：阻塞时逐项列出原因（手动休眠的失败反馈需要逐项文案，不能只给布尔）。
 */
export function evaluateDormancyGate(facts: DormancyFacts): { ok: boolean; blockers: DormancyBlocker[] } {
    const blockers: DormancyBlocker[] = []
    if (facts.pendingPermissions > 0) blockers.push('pending_permissions')
    if (facts.queuedMessages > 0) blockers.push('queued_messages')
    if (facts.turnRunning) blockers.push('turn_running')
    if (facts.liveTerminals > 0) blockers.push('live_terminals')
    if (facts.backgroundTasks > 0) blockers.push('background_tasks')
    return { ok: blockers.length === 0, blockers }
}
