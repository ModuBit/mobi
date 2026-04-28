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
import { getInputStringAny } from '@/core/lib/toolInputUtils'

// 测试命令提取逻辑（使用 getInputStringAny）
describe('command extraction via getInputStringAny', () => {
    it('should extract command from object with command field', () => {
        expect(getInputStringAny({ command: 'git status' }, ['command', 'cmd'])).toBe('git status')
    })

    it('should extract command from object with cmd field', () => {
        expect(getInputStringAny({ cmd: 'npm test' }, ['command', 'cmd'])).toBe('npm test')
    })

    it('should return null for object without command/cmd', () => {
        expect(getInputStringAny({ foo: 'bar' }, ['command', 'cmd'])).toBe(null)
    })

    it('should prioritize command over cmd', () => {
        expect(getInputStringAny({ command: 'first', cmd: 'second' }, ['command', 'cmd'])).toBe('first')
    })
})

// 测试输出提取逻辑
describe('extractOutputText', () => {
    function extractOutputText(result: unknown): string | null {
        if (result === null || result === undefined) return null
        if (typeof result === 'string') {
            const match = result.match(/<tool_use_error>(.*?)<\/tool_use_error>/s)
            if (match) return match[1]?.trim() ?? ''
            return result
        }
        if (!result || typeof result !== 'object') return null
        const obj = result as Record<string, unknown>

        const stdout = typeof obj.stdout === 'string' ? obj.stdout : null
        const stderr = typeof obj.stderr === 'string' ? obj.stderr : null
        if (stdout !== null || stderr !== null) {
            const parts: string[] = []
            if (stdout) parts.push(stdout)
            if (stderr) parts.push(stderr)
            return parts.join('\n')
        }

        if (typeof obj.content === 'string') return obj.content
        if (typeof obj.text === 'string') return obj.text
        if (typeof obj.output === 'string') return obj.output
        if (typeof obj.error === 'string') return obj.error
        if (typeof obj.message === 'string') return obj.message

        return null
    }

    it('should extract string result directly', () => {
        expect(extractOutputText('output text')).toBe('output text')
    })

    it('should extract error message from tool_use_error tag', () => {
        expect(extractOutputText('<tool_use_error>Command failed</tool_use_error>')).toBe('Command failed')
    })

    it('should extract stdout from result object', () => {
        expect(extractOutputText({ stdout: 'standard output' })).toBe('standard output')
    })

    it('should combine stdout and stderr', () => {
        expect(extractOutputText({ stdout: 'out', stderr: 'err' })).toBe('out\nerr')
    })

    it('should extract content field', () => {
        expect(extractOutputText({ content: 'file content' })).toBe('file content')
    })

    it('should return null for null result', () => {
        expect(extractOutputText(null)).toBe(null)
    })
})

// 测试错误判断逻辑
describe('isErrorResult', () => {
    function isErrorResult(result: unknown): boolean {
        if (!result || typeof result !== 'object') return false
        const obj = result as Record<string, unknown>
        if (obj.is_error === true) return true
        if (typeof obj.exit_code === 'number' && obj.exit_code !== 0) return true
        if (obj.error !== undefined && obj.error !== null) return true
        return false
    }

    it('should detect is_error flag', () => {
        expect(isErrorResult({ is_error: true })).toBe(true)
        expect(isErrorResult({ is_error: false })).toBe(false)
    })

    it('should detect non-zero exit_code', () => {
        expect(isErrorResult({ exit_code: 1 })).toBe(true)
        expect(isErrorResult({ exit_code: 0 })).toBe(false)
        expect(isErrorResult({ exit_code: 127 })).toBe(true)
    })

    it('should detect error field', () => {
        expect(isErrorResult({ error: 'something went wrong' })).toBe(true)
        expect(isErrorResult({ error: null })).toBe(false)
    })

    it('should return false for null/undefined', () => {
        expect(isErrorResult(null)).toBe(false)
        expect(isErrorResult(undefined)).toBe(false)
    })

    it('should return false for plain object', () => {
        expect(isErrorResult({ foo: 'bar' })).toBe(false)
    })
})
