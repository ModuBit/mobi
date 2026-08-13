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
 * 验证 claude 命令参数解析中 --project 的处理（项目实体化 Task 6）。
 *
 * @see packages/cli/src/commands/claudeArgs.ts
 */

import { describe, expect, it } from 'vitest'
import { parseStartOptions } from '@/commands/claudeArgs'

describe('parseStartOptions --project', () => {
    it('解析 --project foo 进 options.projectId', () => {
        const { options, unknownArgs } = parseStartOptions(['--project', 'foo'])
        expect(options.projectId).toBe('foo')
        expect(unknownArgs).toEqual([])
    })

    it('缺值 → 抛错', () => {
        expect(() => parseStartOptions(['--project'])).toThrow(/Missing --project value/i)
    })

    it('与 --permission-mode 等其他参数共存互不干扰', () => {
        const { options, unknownArgs } = parseStartOptions([
            '--permission-mode', 'plan',
            '--project', 'p1',
            '--extra-flag', 'value'
        ])
        expect(options.projectId).toBe('p1')
        expect(options.permissionMode).toBe('plan')
        expect(unknownArgs).toEqual(['--extra-flag', 'value'])
    })
})
