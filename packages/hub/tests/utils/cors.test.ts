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
import { assertCorsOriginsForCredentials } from '../../src/utils/cors'

describe('assertCorsOriginsForCredentials', () => {
    test('credentials:true + 含 "*" → throw', () => {
        expect(() => assertCorsOriginsForCredentials(['*'], true)).toThrow(/CORS/)
        expect(() => assertCorsOriginsForCredentials(['https://a.com', '*'], true)).toThrow(/CORS/)
    })

    test('credentials:true + 具体域名 → 不 throw', () => {
        expect(() => assertCorsOriginsForCredentials(['https://a.com'], true)).not.toThrow()
        expect(() => assertCorsOriginsForCredentials(['https://a.com', 'https://b.com'], true)).not.toThrow()
    })

    test('credentials:false + 含 "*" → 不 throw（socket 层合法）', () => {
        expect(() => assertCorsOriginsForCredentials(['*'], false)).not.toThrow()
    })

    test('空 origins 列表 → 不 throw', () => {
        expect(() => assertCorsOriginsForCredentials([], true)).not.toThrow()
    })
})
