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
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 验证 runner spawn 时 mobi CLI 参数构造中 --workspace 的透传（工作区实体化 Task 6）。
 *
 * @see packages/cli/src/runner/spawnArgs.ts
 */

import { describe, expect, it } from 'vitest'
import { buildClaudeSpawnArgs } from '@/executor/spawnArgs'

describe('buildClaudeSpawnArgs --workspace', () => {
    it('带 workspaceId → args 含 [--workspace, id]', () => {
        const args = buildClaudeSpawnArgs({
            directory: '/a/mobi',
            workspaceId: 'p1'
        })
        expect(args).toContain('--workspace')
        expect(args[args.indexOf('--workspace') + 1]).toBe('p1')
    })

    it('不带 workspaceId → args 无 --workspace', () => {
        const args = buildClaudeSpawnArgs({ directory: '/a/mobi' })
        expect(args.some(a => a === '--workspace')).toBe(false)
    })
})
