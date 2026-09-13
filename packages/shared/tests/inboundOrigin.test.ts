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

import { describe, it, expect } from 'vitest'
import {
    readCrossSessionOrigin,
    isMobiSentCrossSession,
    readTurnOrigin,
    toCrossSessionMeta,
    TURN_ORIGINS,
    CrossSessionMetaSchema,
    type CrossSessionOrigin,
} from '../src/inboundOrigin'

/** mobi 自发投递：名字 + id 齐全 */
const mobiSent: CrossSessionOrigin = { fromName: '跨会话消息测试', fromSessionId: 'sess-a' }
/** CC 原生 peer：只有名字，反查不到会话 */
const nativePeer: CrossSessionOrigin = { fromName: 'mobi-ab', fromSessionId: null }

describe('readCrossSessionOrigin', () => {
    it('mobi 自发投递（有 fromSessionId）→ 名字与 id 原样读出', () => {
        expect(readCrossSessionOrigin(toCrossSessionMeta(mobiSent))).toEqual(mobiSent)
    })

    it('CC 原生 peer（无 fromSessionId）→ fromSessionId 为 null，而不是判成「不是跨会话消息」', () => {
        expect(readCrossSessionOrigin(toCrossSessionMeta(nativePeer))).toEqual(nativePeer)
    })

    it('发送方未命名（from 为空串）→ 仍是一条跨会话消息，fromName 为空串', () => {
        // 这是 2026-09-12 修过的那一类：拿「from 非空」当判据会让这类消息的标签整条消失，
        // 看起来像用户自己发的。判据必须是「crossSession 是个对象」。
        const origin = readCrossSessionOrigin({ crossSession: { from: '' } })
        expect(origin).not.toBeNull()
        expect(origin?.fromName).toBe('')
    })

    it('from 不是字符串 → 归一为空串，不当成没有来源', () => {
        expect(readCrossSessionOrigin({ crossSession: { from: 42 } })?.fromName).toBe('')
    })

    it('fromSessionId 是空串 → 等同没有（空串带不了身份）', () => {
        expect(readCrossSessionOrigin({ crossSession: { from: 'x' }, fromSessionId: '' })).toEqual({
            fromName: 'x',
            fromSessionId: null,
        })
    })

    it('普通用户消息（无 crossSession）→ null', () => {
        expect(readCrossSessionOrigin({ sentFrom: 'webapp' })).toBeNull()
    })

    it('只有 turnOrigin（scheduled / loop 唤醒）→ null：那不是跨会话消息', () => {
        expect(readCrossSessionOrigin({ sentFrom: 'cli', turnOrigin: 'scheduled' })).toBeNull()
    })

    it('meta 缺失 / 不是对象 / crossSession 不是对象 → 一律 null', () => {
        expect(readCrossSessionOrigin(undefined)).toBeNull()
        expect(readCrossSessionOrigin(null)).toBeNull()
        expect(readCrossSessionOrigin('crossSession')).toBeNull()
        expect(readCrossSessionOrigin({ crossSession: 'peer' })).toBeNull()
    })
})

describe('isMobiSentCrossSession（守落库行 → SDK 的那道闸）', () => {
    it('mobi 自发投递 → true', () => {
        expect(isMobiSentCrossSession({ meta: toCrossSessionMeta(mobiSent) })).toBe(true)
    })

    it('CC 原生 peer → false（它没有投递通道，只在 hook 观测时落库）', () => {
        expect(isMobiSentCrossSession({ meta: toCrossSessionMeta(nativePeer) })).toBe(false)
    })

    it('不是跨会话消息时**不能**判成 true', () => {
        // 曾经的写法 `origin?.fromSessionId !== null` 会在 origin 为 null 时算出
        // `undefined !== null` = true，把每一条普通消息都当成 mobi 投递的丢掉
        expect(isMobiSentCrossSession({ meta: { sentFrom: 'webapp' } })).toBe(false)
        expect(isMobiSentCrossSession({ meta: {} })).toBe(false)
        expect(isMobiSentCrossSession({})).toBe(false)
        expect(isMobiSentCrossSession(null)).toBe(false)
        expect(isMobiSentCrossSession('plain')).toBe(false)
    })
})

describe('readTurnOrigin', () => {
    it('三个合法值原样返回', () => {
        for (const kind of TURN_ORIGINS) {
            expect(readTurnOrigin({ turnOrigin: kind })).toBe(kind)
        }
    })

    it('缺失 / 非合法枚举 / 非字符串 / meta 缺失 → 一律 null', () => {
        expect(readTurnOrigin({})).toBeNull()
        expect(readTurnOrigin({ turnOrigin: 'unknown' })).toBeNull()
        expect(readTurnOrigin({ turnOrigin: 42 })).toBeNull()
        expect(readTurnOrigin(undefined)).toBeNull()
    })
})

describe('toCrossSessionMeta', () => {
    it('有 id 时两个键都写，且形状与存量行一致', () => {
        expect(toCrossSessionMeta(mobiSent)).toEqual({
            crossSession: { from: '跨会话消息测试' },
            fromSessionId: 'sess-a',
        })
    })

    it('无 id（CC 原生 peer）时不写 fromSessionId 键，而不是写一个 undefined', () => {
        const meta = toCrossSessionMeta(nativePeer)
        expect('fromSessionId' in meta).toBe(false)
        expect(meta).toEqual({ crossSession: { from: 'mobi-ab' } })
    })

    it('名字为空串也照写 crossSession——Web 的 compact 守卫靠这个键排除跨会话消息', () => {
        expect(toCrossSessionMeta({ fromName: '', fromSessionId: null })).toEqual({
            crossSession: { from: '' },
        })
    })

    it('产出能被 CrossSessionMetaSchema 接受，也能被读取侧读回', () => {
        for (const origin of [mobiSent, nativePeer, { fromName: '', fromSessionId: 's' }]) {
            const meta = toCrossSessionMeta(origin)
            expect(CrossSessionMetaSchema.safeParse(meta).success).toBe(true)
            expect(readCrossSessionOrigin(meta)).toEqual(origin)
        }
    })
})
