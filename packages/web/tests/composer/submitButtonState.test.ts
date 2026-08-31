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
import { resolveStopPress, LONG_PRESS_MS } from '@/components/composer/submitButtonState'

describe('resolveStopPress（停止按钮长按阈值判定）', () => {
    it('短于阈值 → click', () => expect(resolveStopPress(200)).toBe('click'))
    it('达到阈值 → longpress', () => expect(resolveStopPress(500)).toBe('longpress'))
    it('阈值为 500ms（spec D1）', () => expect(LONG_PRESS_MS).toBe(500))
})
