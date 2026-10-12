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
 * DiffTarget ↔ 序列化键互逆对单测（分层治理票 01 自 reviewEntries 迁入）。
 * 菜单 key / query key / viewState 共用同一 wire 契约——往返一致与损坏输入行为在此锁死。
 */

import { describe, expect, it } from 'vitest'
import { parseTargetKey, serializeTargetKey } from '@/core/lib/targetKey'
import type { DiffTarget } from '@mobi/shared'

describe('serializeTargetKey / parseTargetKey（序列化键往返）', () => {
    it('三种 kind 往返一致', () => {
        for (const t of [
            { kind: 'turn' } as DiffTarget,
            { kind: 'turn', turnIndex: 3 } as DiffTarget,
            { kind: 'worktree', area: 'uncommitted' } as DiffTarget,
            { kind: 'commit', range: { base: 'a', head: 'b' } } as DiffTarget,
        ]) {
            expect(parseTargetKey(serializeTargetKey(t))).toEqual(t)
        }
    })

    it('损坏输入抛错（调用方吞掉不切档）', () => {
        expect(() => parseTargetKey('not json')).toThrow()
        expect(() => parseTargetKey(JSON.stringify({ kind: 'branch' }))).toThrow()
    })
})
