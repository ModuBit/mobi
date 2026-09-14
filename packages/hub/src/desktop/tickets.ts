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
 * 一次性票据 store（desktop 观看/attach 凭据的底座）。
 *
 * 语义：mint 签发短时效票据 → consume 单次兑换（兑换即焚）→ 过期/取消均不可兑换。
 * 时钟由调用方注入（nowMs），测试与过期判定不依赖真实时间。
 */

import { randomBytes } from 'node:crypto'

export interface TicketGrant {
    token: string
    expiresAtMs: number
}

export interface OneTimeTicketStore<T> {
    /** 签发一张一次性票据，返回 token 与过期时刻 */
    mint(payload: T, options: { nowMs: number; ttlMs?: number }): TicketGrant
    /** 单次兑换：有效期内首次调用返回 payload 并焚毁，其余情况返回 null */
    consume(token: string, nowMs: number): T | null
    /** 主动作废（会话被抢占/取消时），不存在的 token 静默 */
    cancel(token: string): void
}

interface TicketEntry<T> {
    payload: T
    expiresAtMs: number
}

/** 默认 TTL：desktop 凭据的短时效基线（spec：60s 一次性票据） */
const DEFAULT_TICKET_TTL_MS = 60_000

/** token 字节数：48 hex 字符，与 openclaw 同量级（不可预测 + URL 安全） */
const TICKET_BYTES = 24

export function createOneTimeTicketStore<T>(options: {
    defaultTtlMs?: number
} = {}): OneTimeTicketStore<T> {
    const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TICKET_TTL_MS
    const entries = new Map<string, TicketEntry<T>>()

    return {
        mint(payload, { nowMs, ttlMs }) {
            const token = randomBytes(TICKET_BYTES).toString('hex')
            const expiresAtMs = nowMs + (ttlMs ?? defaultTtlMs)
            entries.set(token, { payload, expiresAtMs })
            return { token, expiresAtMs }
        },

        consume(token, nowMs) {
            const entry = entries.get(token)
            if (!entry) {
                return null
            }
            entries.delete(token)
            if (nowMs >= entry.expiresAtMs) {
                return null
            }
            return entry.payload
        },

        cancel(token) {
            entries.delete(token)
        },
    }
}
