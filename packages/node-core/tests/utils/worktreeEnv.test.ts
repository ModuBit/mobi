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

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock child_process 的 execFileSync
const { mockExecFileSync } = vi.hoisted(() => ({
    mockExecFileSync: vi.fn(),
}))
vi.mock('node:child_process', () => ({
    execFileSync: mockExecFileSync,
}))

// mock fs 相关
vi.mock('node:fs', () => ({
    realpathSync: (p: string) => p,
    statSync: vi.fn(),
}))

// mock logger
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}))

import { readGitBranch } from '@/utils/worktreeEnv'

describe('readGitBranch', () => {
    beforeEach(() => {
        mockExecFileSync.mockReset()
    })

    it('正常分支名返回 symbolic-ref 结果', () => {
        mockExecFileSync.mockReturnValue('  feature/auth  \n')
        expect(readGitBranch('/home/user/project')).toBe('feature/auth')
    })

    it('symbolic-ref 失败时降级为 rev-parse 短 hash', () => {
        mockExecFileSync
            .mockImplementationOnce(() => { throw new Error('not a symbolic ref') })
            .mockReturnValueOnce('abc1234\n')
        expect(readGitBranch('/home/user/project')).toBe('abc1234')
    })

    it('两个命令都失败时返回 null', () => {
        mockExecFileSync.mockImplementation(() => {
            throw new Error('not a git repo')
        })
        expect(readGitBranch('/home/user/project')).toBeNull()
    })

    it('git 未安装时返回 null 不抛异常', () => {
        mockExecFileSync.mockImplementation(() => {
            throw new Error('spawn git ENOENT')
        })
        expect(readGitBranch('/home/user/project')).toBeNull()
    })
})
