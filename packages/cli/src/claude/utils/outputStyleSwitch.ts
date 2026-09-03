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

import { OUTPUT_STYLE_EXIT_SENTINEL } from './outputStyleSentinel'
import type { EnhancedMode } from '../types'

/** applyOutputStyleSwitch 的依赖（结构化注入便于测试；mode 类型对齐 MessageQueue.pushIsolateAndClear） */
export interface OutputStyleSwitchDeps {
    /** 前台 turn 是否运行中（闸门：running 中拒绝切换） */
    running: boolean
    /** 更新 session.outputStyle（下轮循环经 applyStartupOutputStyle 生效） */
    setOutputStyle: (style: string) => void
    /** 清除 native sessionId（下次循环不 resume、起新 native query，/clear 语义） */
    clearSessionId: () => void
    /** 置位 session.pendingOutputStyleExit（launcher 消费哨兵时读位放行退轮） */
    markPendingExit: () => void
    /** 清空未消费排队项（丢弃项经 onBatchConsumed 通知 Hub，对齐 /clear 丢弃路径） */
    clearPending: () => void
    /** 入队 isolate 哨兵（唤醒阻塞中的 nextMessage 并触发当前 query 循环退出） */
    pushIsolateAndClear: (message: string, mode: EnhancedMode, localId?: string) => void
}

/**
 * output style 切换受理（/clear 语义）：
 * 更新 style → 清 sessionId（下次循环起新 native query）→ 清排队 →
 * 置 pendingOutputStyleExit + 入队哨兵退出当前 query 循环。
 *
 * 时序约束：pendingOutputStyleExit 置位与哨兵入队必须在同一同步段（本函数全程无 await，
 * 天然满足）——哨兵先到而标志后置会被 launcher 判为 stale 丢弃、白耗一次哨兵。
 *
 * 机制与 rewind 受理（rewindHandlers.ts）同构；差异：rewind 保留 sessionId（resume 截断），
 * 本操作清 sessionId（/clear 重开）。同值切换也受理——幂等重启是用户明确请求的 /clear 语义。
 */
export function applyOutputStyleSwitch(deps: OutputStyleSwitchDeps, style: string): { accepted: boolean; reason?: string } {
    if (deps.running) {
        return { accepted: false, reason: 'session is running' };
    }
    deps.setOutputStyle(style);
    deps.clearSessionId();
    deps.clearPending();
    deps.markPendingExit();
    deps.pushIsolateAndClear(OUTPUT_STYLE_EXIT_SENTINEL, { permissionMode: 'default' });
    return { accepted: true };
}
