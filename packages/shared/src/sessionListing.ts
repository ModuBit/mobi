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
 * 跨包共享，故形状定义在此。可 fork 状态集与标题取值链也收口于此——
 * daemon 侧的 SQL 过滤、类型收窄与 Web 侧展示各自消费同一份定义，
 * 避免三处独立拼写后调整状态集时静默失配。
 */
import type { SessionStatus } from './schemas'

/** 可 fork / 可列示的保留状态（archived 等状态在查询层排除）；satisfies 锁定成员必须落在 SessionStatus 枚举内 */
export const FORKABLE_STATUSES = ['online', 'dormant'] as const satisfies readonly SessionStatus[]
export type ForkableStatus = (typeof FORKABLE_STATUSES)[number]

export type ForkableSession = {
    /** mobi 会话行 id（用户可见短 id 的来源） */
    id: string
    /** 会话标题（resolveSessionTitle 单源取值链的产物），无则 null */
    title: string | null
    /** 会话工作目录（fork 进程的 cwd） */
    path: string
    /**
     * Claude Code 原生会话 id（claude --resume 的目标）。
     * null = SDK 尚未回报（会话创建后未产生消息的启动/退出期）：行可列示
     * （sessions list 看得到、拿得到 mobi id 去 stop），但不可 fork。
     */
    nativeSessionId: string | null
    /** 最近活跃时刻（列表排序键） */
    updatedAt: number
    /** 保留状态：online 表示进程仍在线（可能正在执行 turn） */
    status: ForkableStatus
}

/**
 * 会话显示标题的单源取值链：非 fork 行 summary.text 优先（CLI summary 事件会回填
 * metadata 并覆盖 name，Web 展示以 summary 为准），fork 行反转 name 优先（fork 行
 * 标题由 daemon 建行时落库、含「· 分叉」身份后缀，不能被 fork 自身产出的 summary 盖掉）。
 *
 * daemon 只读投影（mobi fork / sessions list 的 title 字段）与 Web getSessionDisplayName
 * 共用此链——此前两处独立取值导致「照 Web 标题 fork 不命中」。path 基名之后的兜底
 * （短 id / Unknown / 未命名）由消费方按各自字段可用性补齐。
 */
export function resolveSessionTitle(input: {
    name?: string | null
    summaryText?: string | null
    path?: string | null
    isFork: boolean
}): string | null {
    const basename = input.path?.split('/').pop() || null
    const base = input.name || basename
    if (input.isFork) return base ?? null
    return input.summaryText || base || null
}
