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

import type { Session } from '@mobi/shared/types'

/**
 * 会话行删除守卫（单一来源，web 路由预检与 sessionCache.deleteSession 共用）：
 *
 * 常规会话：active 行不可删（须先归档）——防误删有 CLI 进程挂靠的会话。
 * fork 行（fork-session spec §4.3/§5.3）：metadata.forkFrom 在场 = 未完成激活
 * （激活成功即被 hub 清除；激活失败错误态也保留 forkFrom）——「fork 行未激活不算 active」，
 * 待激活/错误态均可删除。激活进行中（running，首条消息已触发 spawn）仍保护，
 * 避免删行后孤儿化 CLI 进程。
 */
export function isSessionRowDeletable(session: Pick<Session, 'active' | 'running' | 'metadata'>): boolean {
    if (!session.active) return true
    if (session.running) return false
    return Boolean(session.metadata?.forkFrom)
}
