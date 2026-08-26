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
import { guessContextWindow } from '../../../src/claude/utils/modelContextWindow'

describe('guessContextWindow', () => {
    it('名字含 [1m]（忽略大小写）→ 1M 窗口', () => {
        expect(guessContextWindow('claude-opus-4-8[1M]')).toBe(1_000_000)
        expect(guessContextWindow('claude-sonnet-4-6[1m]')).toBe(1_000_000)
        expect(guessContextWindow('some-gateway-model[1M]-suffix')).toBe(1_000_000)
    })

    it('其余一律 200k（claude 标准窗口 / 未知网关模型名）', () => {
        expect(guessContextWindow('claude-opus-4-8')).toBe(200_000)
        expect(guessContextWindow('claude-sonnet-4-6')).toBe(200_000)
        // 用户拍板：非 [1m] 不区分已知/未知，统一 200k；猜错由 result.modelUsage 权威修正
        expect(guessContextWindow('glm-5.2')).toBe(200_000)
    })

    it('模型名缺失 → undefined（调用方保持等 result 兜底）', () => {
        expect(guessContextWindow(undefined)).toBeUndefined()
        expect(guessContextWindow('')).toBeUndefined()
    })
})
