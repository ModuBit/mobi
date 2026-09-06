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

import { RESTART_EXIT_SENTINEL } from './queryRestart'
import type { EnhancedMode } from '../types'

/** applyOutputStyleSwitch 的依赖（结构化注入便于测试；mode 类型对齐 MessageQueue.pushIsolateAndClear） */
export interface OutputStyleSwitchDeps {
    /** 前台 turn 是否运行中（闸门：running 中拒绝切换） */
    running: boolean
    /**
     * 重启通道占用中（pendingRestart 槽非空——含 rewind 待截断 / rewindInFlight 受理中）：
     * 此时受理切换的 clearPending 会静默吞掉对方的退出哨兵，产生「已清 sessionId + 残留
     * 对方请求」坏组合（resumeSessionAt 语义悬空 / rewind-completed 永不回报）——拒绝优于清位
     */
    restartBusy: boolean
    /** 更新 session.outputStyle（下轮循环经 applyStartupOutputStyle 生效） */
    setOutputStyle: (style: string) => void
    /** 清除 native sessionId（下次循环不 resume、起新 native query，/clear 语义） */
    clearSessionId: () => void
    /** 置位 session.pendingRestart = { kind: 'outputStyle' }（launcher 消费哨兵时读位放行退轮） */
    markPendingRestart: () => void
    /** 清空未消费排队项（丢弃项经 onBatchConsumed 通知 Hub，对齐 /clear 丢弃路径） */
    clearPending: () => void
    /** 入队 isolate 哨兵（唤醒阻塞中的 nextMessage 并触发当前 query 循环退出） */
    pushIsolateAndClear: (message: string, mode: EnhancedMode, localId?: string) => void
}

/**
 * output style 切换受理（/clear 语义）：
 * 更新 style → 清 sessionId（下次循环起新 native query）→ 清排队 →
 * 置 pendingRestart{outputStyle} + 入队哨兵退出当前 query 循环。
 *
 * 时序约束：pendingRestart 置位与哨兵入队必须在同一同步段（本函数全程无 await，
 * 天然满足）——哨兵先到而槽位后置会被 launcher 判为 stale 丢弃、白耗一次哨兵。
 *
 * 机制与 rewind 受理（rewindHandlers.ts）共用单槽 pendingRestart（见 queryRestart.ts）；
 * 差异：rewind 保留 sessionId（resume 截断），本操作清 sessionId（/clear 重开）。
 * 同值切换也受理——幂等重启是用户明确请求的 /clear 语义。
 */
export function applyOutputStyleSwitch(deps: OutputStyleSwitchDeps, style: string): { accepted: boolean; reason?: string } {
    if (deps.running) {
        return { accepted: false, reason: 'session is running' };
    }
    // 重启通道占用窗口（槽非空或 rewind 受理中）拒绝：clearPending 会吞掉对方哨兵，
    // 且清 sessionId 后残留的对方请求语义悬空——拒绝优于清位
    if (deps.restartBusy) {
        return { accepted: false, reason: 'rewind is in progress' };
    }
    deps.setOutputStyle(style);
    deps.clearSessionId();
    deps.clearPending();
    deps.markPendingRestart();
    deps.pushIsolateAndClear(RESTART_EXIT_SENTINEL, { permissionMode: 'default' });
    return { accepted: true };
}
