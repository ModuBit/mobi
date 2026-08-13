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

describe('parseStartOptions 既有 flag 回归（锁定搬迁前行为）', () => {
    it('--yolo → bypassPermissions 且透传 --dangerously-skip-permissions', () => {
        const { options, unknownArgs } = parseStartOptions(['--yolo'])
        expect(options.permissionMode).toBe('bypassPermissions')
        expect(unknownArgs).toEqual(['--dangerously-skip-permissions'])
    })

    it('--dangerously-skip-permissions → bypassPermissions 且透传', () => {
        const { options, unknownArgs } = parseStartOptions(['--dangerously-skip-permissions'])
        expect(options.permissionMode).toBe('bypassPermissions')
        expect(unknownArgs).toEqual(['--dangerously-skip-permissions'])
    })

    it('--model 与 -m 均解析模型并透传', () => {
        const a = parseStartOptions(['--model', 'sonnet'])
        expect(a.options.model).toBe('sonnet')
        expect(a.unknownArgs).toEqual(['--model', 'sonnet'])

        const b = parseStartOptions(['-m', 'opus'])
        expect(b.options.model).toBe('opus')
        expect(b.unknownArgs).toEqual(['--model', 'opus'])
    })

    it('--model 缺值 → 抛错', () => {
        expect(() => parseStartOptions(['--model'])).toThrow(/Missing --model value/i)
    })

    it('--effort 解析并透传', () => {
        const { options, unknownArgs } = parseStartOptions(['--effort', 'high'])
        expect(options.effort).toBe('high')
        expect(unknownArgs).toEqual(['--effort', 'high'])
    })

    it('--effort 缺值 → 抛错', () => {
        expect(() => parseStartOptions(['--effort'])).toThrow(/Missing --effort value/i)
    })

    it('--permission-mode 解析合法值，缺值/非法值抛错', () => {
        expect(parseStartOptions(['--permission-mode', 'plan']).options.permissionMode).toBe('plan')
        expect(() => parseStartOptions(['--permission-mode'])).toThrow(/Missing --permission-mode value/i)
        expect(() => parseStartOptions(['--permission-mode', 'bogus'])).toThrow()
    })

    it('--started-by / --mobi-starting-mode 解析', () => {
        const { options } = parseStartOptions(['--started-by', 'runner', '--mobi-starting-mode', 'remote'])
        expect(options.startedBy).toBe('runner')
        expect(options.startingMode).toBe('remote')
    })

    it('--mobi-starting-mode 非法值 → 抛错', () => {
        expect(() => parseStartOptions(['--mobi-starting-mode', 'bogus'])).toThrow()
    })

    it('-h/--help 置 showHelp 并透传；未知 flag 及其取值透传', () => {
        const { showHelp, unknownArgs } = parseStartOptions([
            '-h', '--verbose', '--unknown-flag', 'its-value', 'bare-arg'
        ])
        expect(showHelp).toBe(true)
        expect(unknownArgs).toEqual(['-h', '--verbose', '--unknown-flag', 'its-value', 'bare-arg'])
    })
})
