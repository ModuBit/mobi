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

import type { RpcAcceptResult } from '@mobi/shared'
import type { QueryRestartController } from './queryRestart'

/** output style 受理所需的最小会话视图；重启协议细节封装在 restart module 内。 */
export interface OutputStyleSwitchDeps {
    /** 前台 turn 是否运行中（闸门：running 中拒绝切换） */
    running: boolean
    restart: QueryRestartController
    /** 更新 session.outputStyle（下轮循环经 applyStartupOutputStyle 生效） */
    setOutputStyle: (style: string) => void
    /** 清除 native sessionId（下次循环不 resume、起新 native query，/clear 语义） */
    clearSessionId: () => void
}

/**
 * output style 切换受理（/clear 语义）：
 * 更新 style + 清 sessionId 后向 restart module 提交 outputStyle 意图；清排队、状态置位、
 * 哨兵配对与同步时序均由 restart module 保证。
 *
 * 机制与 rewind 受理（rewindHandlers.ts）共用 restart module 的单槽；
 * 差异：rewind 保留 sessionId（resume 截断），本操作清 sessionId（/clear 重开）。
 * 同值切换也受理——幂等重启是用户明确请求的 /clear 语义。
 */
export function applyOutputStyleSwitch(deps: OutputStyleSwitchDeps, style: string): RpcAcceptResult {
    if (deps.running) {
        return { accepted: false, reason: 'session is running' };
    }

    const scheduled = deps.restart.trySchedule({ kind: 'outputStyle' }, () => {
        deps.setOutputStyle(style);
        deps.clearSessionId();
    });
    if (!scheduled) {
        return { accepted: false, reason: 'rewind is in progress' };
    }
    return { accepted: true };
}
