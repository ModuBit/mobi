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
    ALLOWED_EXTENSIONS,
    BLOCKED_EXTENSIONS,
    ALLOWED_EXTENSIONS_SET,
    BLOCKED_EXTENSIONS_SET,
    MAX_UPLOAD_BYTES,
} from '../src/upload'

describe('upload constants', () => {
    describe('ALLOWED_EXTENSIONS', () => {
        it('应包含 CLI 独有的扩展名', () => {
            const cliOnly = ['.tiff', '.tif', '.odt', '.ods', '.odp', '.graphql', '.proto', '.dockerfile', '.astro', '.wma', '.wmv', '.flv', '.scala', '.bash', '.zsh', '.cfg']
            for (const ext of cliOnly) {
                expect(ALLOWED_EXTENSIONS_SET.has(ext), `${ext} 应在白名单中`).toBe(true)
            }
        })

        it('应包含 Web 独有的扩展名', () => {
            const webOnly = ['.hpp', '.dart', '.lua', '.r', '.env', '.properties', '.gradle', '.cmake']
            for (const ext of webOnly) {
                expect(ALLOWED_EXTENSIONS_SET.has(ext), `${ext} 应在白名单中`).toBe(true)
            }
        })

        it('不应有重复项', () => {
            const unique = new Set(ALLOWED_EXTENSIONS)
            expect(unique.size).toBe(ALLOWED_EXTENSIONS.length)
        })
    })

    describe('BLOCKED_EXTENSIONS', () => {
        it('应包含常见可执行文件类型', () => {
            const required = ['.exe', '.bat', '.cmd', '.msi', '.com', '.scr', '.dll', '.so', '.dylib', '.app', '.dmg', '.deb', '.rpm', '.iso']
            for (const ext of required) {
                expect(BLOCKED_EXTENSIONS_SET.has(ext), `${ext} 应在黑名单中`).toBe(true)
            }
        })

        it('不应有重复项', () => {
            const unique = new Set(BLOCKED_EXTENSIONS)
            expect(unique.size).toBe(BLOCKED_EXTENSIONS.length)
        })

        it('黑名单与白名单不应有交集', () => {
            for (const ext of BLOCKED_EXTENSIONS) {
                expect(ALLOWED_EXTENSIONS_SET.has(ext), `${ext} 不应同时在黑白名单中`).toBe(false)
            }
        })
    })

    describe('MAX_UPLOAD_BYTES', () => {
        it('应为 50MB', () => {
            expect(MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024)
        })
    })
})
