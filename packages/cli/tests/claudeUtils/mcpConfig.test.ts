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

import { describe, expect, it } from 'vitest'
import { resolveMcpConfigArg, appendMcpConfigArg } from '@/claude/utils/mcpConfig'

describe('resolveMcpConfigArg（local 模式 --mcp-config 序列化）', () => {
    it('过滤 SDK in-process server 条目（不可 JSON 序列化，local 模式不做 web 工具替换）', () => {
        const arg = resolveMcpConfigArg({
            'mobi': { type: 'http', url: 'http://127.0.0.1:1/' },
            'mobi-web': { type: 'sdk', name: 'mobi-web', version: '1.0.0', instance: {} },
        })
        const parsed = JSON.parse(arg.value) as { mcpServers: Record<string, unknown> }
        expect(Object.keys(parsed.mcpServers)).toEqual(['mobi'])
    })

    it('appendMcpConfigArg：全部为 SDK server → 返回 null（不追加 --mcp-config）', () => {
        const args: string[] = []
        const cleanup = appendMcpConfigArg(args, { 'mobi-web': { type: 'sdk', name: 'mobi-web', instance: {} } })
        expect(cleanup).toBeNull()
        expect(args).toEqual([])
    })

    it('appendMcpConfigArg：混合时保留可序列化条目', () => {
        const args: string[] = []
        appendMcpConfigArg(args, {
            'mobi': { type: 'http', url: 'http://127.0.0.1:1/' },
            'mobi-web': { type: 'sdk', name: 'mobi-web', instance: {} },
        })
        expect(args).toEqual(['--mcp-config', JSON.stringify({ mcpServers: { mobi: { type: 'http', url: 'http://127.0.0.1:1/' } } })])
    })
})
