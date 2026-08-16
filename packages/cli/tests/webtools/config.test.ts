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

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWebToolsConfig, __resetWebToolsConfigCache } from '@/webtools/config'

// readWebToolsConfig 接受文件路径参数（默认 configuration.settingsFile），便于测试注入
let dir: string
let file: string

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'webtools-'))
    file = join(dir, 'settings.json')
    __resetWebToolsConfigCache()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** 显式推 mtime：同一毫秒内两次写文件 mtime 可能不变，会掩盖"重读"路径 */
function bumpMtime(): void {
    const now = new Date()
    utimesSync(file, now, new Date(now.getTime() + 10))
}

describe('readWebToolsConfig（mtime 惰性读）', () => {
    it('文件不存在 → 默认空配置', () => {
        expect(readWebToolsConfig(file)).toEqual({})
    })
    it('写入后读取到新值', () => {
        writeFileSync(file, JSON.stringify({ webTools: { searchProviderId: 'tavily' } }))
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
    })
    it('mtime 不变 → 命中缓存（同对象引用）', () => {
        writeFileSync(file, JSON.stringify({ webTools: {} }))
        const a = readWebToolsConfig(file)
        const b = readWebToolsConfig(file)
        expect(b).toBe(a)
    })
    it('文件损坏 → 沿用上次缓存值', () => {
        writeFileSync(file, JSON.stringify({ webTools: { searchProviderId: 'tavily' } }))
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
        writeFileSync(file, '{broken json')
        bumpMtime()
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
    })
    it('从未成功读过且文件损坏 → 空配置', () => {
        writeFileSync(file, '{broken')
        expect(readWebToolsConfig(file)).toEqual({})
    })
    it('mtime 变化且新内容合法 → 重读返回新配置', () => {
        writeFileSync(file, JSON.stringify({ webTools: { searchProviderId: 'tavily' } }))
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
        writeFileSync(
            file,
            JSON.stringify({
                webTools: {
                    searchProviderId: 'tavily',
                    providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k2' } }],
                },
            }),
        )
        bumpMtime()
        expect(readWebToolsConfig(file)?.providers?.[0]?.credentials.apiKey).toBe('k2')
    })
    it('多文件互不污染：A 的缓存不给损坏的 B 兜底', () => {
        const fileB = join(dir, 'settings-b.json')
        writeFileSync(file, JSON.stringify({ webTools: { searchProviderId: 'tavily' } }))
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
        // B 损坏且从未成功读过 → 空配置，而不是沿用 A 的缓存
        writeFileSync(fileB, '{broken')
        expect(readWebToolsConfig(fileB)).toEqual({})
        // A 的缓存不受 B 的读取影响
        expect(readWebToolsConfig(file)?.searchProviderId).toBe('tavily')
    })
})
