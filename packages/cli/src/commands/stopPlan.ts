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
 * `mobi sessions stop` 的目标解析（发现 C）。
 *
 * sessions list 已换 SQLite 只读投影（打印 8 位短 id、含 dormant 行），stop 若仍拿
 * 用户输入直接打 executor 追踪表（全 id 全等匹配），照列表抄的短 id 必然落空。
 * 此处复用 fork 的 planFork 匹配语义（id 精确 / id 前缀 / 标题）折算回完整 mobi id；
 * 休眠行无进程可停，单独分类让命令层给明确文案而非 Failed。
 * 与命令编排分离的原因同 forkPlan——会话查询依赖 bun:sqlite，选择规则须能在
 * 不碰数据库的前提下被锁定。
 */

import type { ForkableSession } from '@mobi/shared'
import { planFork } from './forkPlan'

export type StopPlan =
    | { kind: 'stop'; session: ForkableSession }
    | { kind: 'dormant'; session: ForkableSession }
    | { kind: 'ambiguous'; matches: ForkableSession[] }
    | { kind: 'not-found'; query: string }
    | { kind: 'empty' }

/** 用户输入 → 停止目标：单一命中才继续；多命中/未命中/空集原样透传给命令层 */
export function planStop(sessions: readonly ForkableSession[], query: string): StopPlan {
    const plan = planFork(sessions, query)
    switch (plan.kind) {
        case 'resolved':
            return plan.session.status === 'dormant'
                ? { kind: 'dormant', session: plan.session }
                : { kind: 'stop', session: plan.session }
        case 'ambiguous':
            return { kind: 'ambiguous', matches: plan.matches }
        case 'not-found':
            return { kind: 'not-found', query: plan.query }
        case 'empty':
            return { kind: 'empty' }
    }
}
