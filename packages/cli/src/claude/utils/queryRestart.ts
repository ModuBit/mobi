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

import type { PendingRewind } from '../types'

/**
 * 重启请求单槽（深化候选④）：rewind 截断重启与 output style /clear 重启共用同一套
 * 「受理检查 → 状态位置位 → 清排队 → 哨兵入队 → launcher 门控退轮 → 循环顶层分派」机制，
 * 此前两套状态位互不知晓，互斥靠 rewindBusy 特判，互吞 bug 由 be966df0 / ecef7061
 * 两次补丁修复——单槽置位即互斥，整类 bug 失去存在土壤。
 */

/**
 * 重启退出哨兵：入队 isolate 队列唤醒阻塞中的 nextMessage，launcher 识别后按
 * session.pendingRestart 门控放行退轮。NUL 前缀防与用户消息文本碰撞（ecef7061）。
 * 只在 CLI 内存队列流转，不跨进程；旧的双哨兵（rewind-exit / output-style-exit）随单槽合并。
 */
export const RESTART_EXIT_SENTINEL = '\x00mobi:restart-exit'

/** 待执行的重启请求（受理侧写、launcher while 循环顶层消费并按 kind 分派） */
export type QueryRestartRequest =
    // rewind：保留 sessionId，以 resumeSessionAt 截断重启（字段语义见 PendingRewind）
    | ({ kind: 'rewind' } & PendingRewind)
    // output style：已 setOutputStyle + 清 sessionId，重启后新 style 生效（/clear 语义）
    | { kind: 'outputStyle' }
