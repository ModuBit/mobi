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
import { formatProtocolVersionHint } from '@/commands/protocolHint'

describe('formatProtocolVersionHint', () => {
    it('版本一致或无版本信息 → 不给提示', () => {
        expect(formatProtocolVersionHint(2, 2)).toBeNull()
        expect(formatProtocolVersionHint(undefined, 2)).toBeNull()
    })

    it('旧 CLI 连新 daemon（CLI 落后）→ 提示升级 CLI', () => {
        expect(formatProtocolVersionHint(2, 1)).toContain('Please update the CLI.')
    })

    it('新 CLI 连旧 daemon（daemon 落后）→ 提示升级 daemon', () => {
        expect(formatProtocolVersionHint(1, 2)).toContain('Please update the daemon.')
    })
})
