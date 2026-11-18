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
 * 终端 fork 的候选会话契约（tui-fork）。
 *
 * 生产者是 daemon 的只读会话查询（SQLite），消费者是 CLI 的 fork 命令；
 * 跨包共享，故形状定义在此。
 */
export type ForkableSession = {
    /** mobi 会话行 id（用户可见短 id 的来源） */
    id: string
    /** 会话标题（自动 summary 或用户命名），无则 null */
    title: string | null
    /** 会话工作目录（fork 进程的 cwd） */
    path: string
    /** Claude Code 原生会话 id（claude --resume 的目标） */
    nativeSessionId: string
    /** 最近活跃时刻（列表排序键） */
    updatedAt: number
    /** 保留状态：online 表示进程仍在线（可能正在执行 turn） */
    status: 'online' | 'dormant'
}
