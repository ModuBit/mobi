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
 * rewind 退出哨兵：rewind RPC handler 入队（isolate）、launcher 的 nextMessage 识别——
 * 触发当前 query 循环退出且不暂存 pending、不推送 SDK，launcher 下轮循环读到
 * session.pendingRewind 后以 resumeSessionAt 截断重启。
 *
 * 这是「让阻塞在 waitForMessagesAndGetAsString 的 query 循环退出」的最小侵入机制，
 * 复用 /clear 的 isolate 退出路径（plan 中的 requestLoopExit 示意名的实际接线）。
 * NUL 前缀确保用户输入不可能碰撞（Web 输入无法产生控制字符）。
 */
export const REWIND_EXIT_SENTINEL = '\x00mobi:rewind-exit';
