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
import { waitForUrlOk } from '@/utils/httpHealth'

describe('waitForUrlOk', () => {
    it('URL 永不可达 → 超时后返回 false 而非抛错', async () => {
        await expect(waitForUrlOk('http://127.0.0.1:1/health', 300, 100)).resolves.toBe(false)
    })
})
