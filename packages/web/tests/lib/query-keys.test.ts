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
 * query-keys 单元测试
 * 确保 React Query 缓存键的一致性（所有 key 是 as const 元组）
 */

import { describe, expect, it } from 'vitest'
import { queryKeys } from '@/core/lib/query-keys'

describe('queryKeys', () => {
    describe('静态 key', () => {
        it('sessions 应为 as const 元组', () => {
            expect(queryKeys.sessions).toEqual(['sessions'])
            expect(Array.isArray(queryKeys.sessions)).toBe(true)
        })

        it('sessionGroups 应为 as const 元组', () => {
            expect(queryKeys.sessionGroups).toEqual(['sessionGroups'])
            expect(Array.isArray(queryKeys.sessionGroups)).toBe(true)
        })

        it('machines 应为 as const 元组', () => {
            expect(queryKeys.machines).toEqual(['machines'])
            expect(Array.isArray(queryKeys.machines)).toBe(true)
        })
    })

    describe('动态 key 工厂函数', () => {
        it('session(id) 应返回正确元组', () => {
            const key = queryKeys.session('sess-1')
            expect(key).toEqual(['session', 'sess-1'])
            expect(key).toHaveLength(2)
        })

        it('不同 sessionId 应产生不同的 key', () => {
            expect(queryKeys.session('a')).not.toEqual(queryKeys.session('b'))
        })

        it('messages(sessionId) 应返回正确元组', () => {
            const key = queryKeys.messages('sess-1')
            expect(key).toEqual(['messages', 'sess-1'])
            expect(key).toHaveLength(2)
        })

        it('groupSessions(groupKey) 应返回正确元组', () => {
            const key = queryKeys.groupSessions('today')
            expect(key).toEqual(['groupSessions', 'today'])
            expect(key).toHaveLength(2)
        })

        it('gitStatus(sessionId) 应返回正确元组', () => {
            const key = queryKeys.gitStatus('sess-1')
            expect(key).toEqual(['git-status', 'sess-1'])
            expect(key).toHaveLength(2)
        })

        it('gitDiff(sessionId) 无 filePath 应返回正确元组', () => {
            const key = queryKeys.gitDiff('sess-1')
            expect(key).toEqual(['git-diff', 'sess-1', undefined])
            expect(key).toHaveLength(3)
        })

        it('gitDiff(sessionId, filePath) 应返回正确元组', () => {
            const key = queryKeys.gitDiff('sess-1', 'src/index.ts')
            expect(key).toEqual(['git-diff', 'sess-1', 'src/index.ts'])
            expect(key).toHaveLength(3)
        })

        it('sessionFiles(sessionId, query) 应返回正确元组', () => {
            const key = queryKeys.sessionFiles('sess-1', 'index')
            expect(key).toEqual(['session-files', 'sess-1', 'index'])
            expect(key).toHaveLength(3)
        })

        it('sessionDirectory(sessionId, path) 应返回正确元组', () => {
            const key = queryKeys.sessionDirectory('sess-1', '/src')
            expect(key).toEqual(['session-directory', 'sess-1', '/src'])
            expect(key).toHaveLength(3)
        })

        it('sessionFile(sessionId, path) 应返回正确元组', () => {
            const key = queryKeys.sessionFile('sess-1', '/src/main.ts')
            expect(key).toEqual(['session-file', 'sess-1', '/src/main.ts'])
            expect(key).toHaveLength(3)
        })

        it('gitFileDiff(sessionId, path, staged=true) 应包含 staged', () => {
            const key = queryKeys.gitFileDiff('sess-1', 'file.ts', true)
            expect(key).toEqual(['git-file-diff', 'sess-1', 'file.ts', 'staged'])
            expect(key).toHaveLength(4)
        })

        it('gitFileDiff(sessionId, path, staged=false) 应包含 unstaged', () => {
            const key = queryKeys.gitFileDiff('sess-1', 'file.ts', false)
            expect(key).toEqual(['git-file-diff', 'sess-1', 'file.ts', 'unstaged'])
            expect(key).toHaveLength(4)
        })

        it('gitFileDiff(sessionId, path) 默认应为 unstaged', () => {
            const key = queryKeys.gitFileDiff('sess-1', 'file.ts')
            expect(key).toEqual(['git-file-diff', 'sess-1', 'file.ts', 'unstaged'])
        })

        it('sdkMetadata(sessionId) 应返回正确元组', () => {
            const key = queryKeys.sdkMetadata('sess-1')
            expect(key).toEqual(['sdkMetadata', 'sess-1'])
            expect(key).toHaveLength(2)
        })
    })

    describe('key 唯一性', () => {
        it('不同类型的静态 key 应互不相等', () => {
            expect(queryKeys.sessions).not.toEqual(queryKeys.machines)
            expect(queryKeys.sessions).not.toEqual(queryKeys.sessionGroups)
            expect(queryKeys.machines).not.toEqual(queryKeys.sessionGroups)
        })

        it('同一工厂函数不同参数应产生不同 key', () => {
            const keys = [
                queryKeys.session('a'),
                queryKeys.messages('a'),
                queryKeys.gitStatus('a'),
                queryKeys.sdkMetadata('a'),
            ]

            // 所有 key 都应互不相同
            const keyStrings = keys.map(k => JSON.stringify(k))
            const uniqueKeys = new Set(keyStrings)
            expect(uniqueKeys.size).toBe(keys.length)
        })
    })
})
