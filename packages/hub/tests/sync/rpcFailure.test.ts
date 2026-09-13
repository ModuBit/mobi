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

import { describe, test, expect } from 'bun:test'
import { RpcFailure, readRpcFailure } from '../../src/sync/rpcFailure'

describe('readRpcFailure', () => {
    test('RpcFailure → 原样读出分类与文案', () => {
        expect(readRpcFailure(new RpcFailure('timeout', 'operation has timed out')))
            .toEqual({ kind: 'timeout', message: 'operation has timed out' })
    })

    test('普通 Error → other + 文案（分类只在产生故障的那一层拿得到，拿不到就不猜）', () => {
        // 钉住这条：句子里恰好有 "timed out" 也**不该**被读成 timeout——这一层没有
        // 判据，硬猜就是把 hub 自己的错说成跨进程的超时
        expect(readRpcFailure(new Error('the wait timed out')))
            .toEqual({ kind: 'other', message: 'the wait timed out' })
    })

    test('非 Error 抛出 → other + String()', () => {
        expect(readRpcFailure('boom')).toEqual({ kind: 'other', message: 'boom' })
        expect(readRpcFailure(undefined)).toEqual({ kind: 'other', message: 'undefined' })
    })
})

describe('RpcFailure', () => {
    test('是 Error 实例——既有链路的 instanceof Error / .message 兜底照常成立', () => {
        const failure = new RpcFailure('unreachable', 'RPC socket disconnected: A:x')

        expect(failure).toBeInstanceOf(Error)
        expect(failure.message).toBe('RPC socket disconnected: A:x')
        expect(failure.kind).toBe('unreachable')
        expect(failure.name).toBe('RpcFailure')
    })
})
