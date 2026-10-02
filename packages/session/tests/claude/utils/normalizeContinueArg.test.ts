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
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { normalizeContinueArg } from '../../../src/claude/utils/normalizeContinueArg'

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
    listSessions: vi.fn(),
}))

const mockListSessions = vi.mocked(listSessions)

beforeEach(() => {
    mockListSessions.mockReset()
})

describe('normalizeContinueArg — -c 规范化为显式 --resume', () => {
    it('无 claudeArgs / 无 -c 时原样返回，不触发 listSessions', async () => {
        await expect(normalizeContinueArg(undefined, '/tmp/x')).resolves.toEqual([])
        expect(mockListSessions).not.toHaveBeenCalled()

        await expect(normalizeContinueArg(['--model', 'sonnet'], '/tmp/x'))
            .resolves.toEqual(['--model', 'sonnet'])
        expect(mockListSessions).not.toHaveBeenCalled()
    })

    it('-c 且目录有历史会话：替换为 --resume <最近 sessionId>', async () => {
        mockListSessions.mockResolvedValue([
            { sessionId: 'abc-123', summary: 's', lastModified: 1, cwd: '/tmp/x' },
        ])

        await expect(normalizeContinueArg(['-c'], '/tmp/x'))
            .resolves.toEqual(['--resume', 'abc-123'])
        expect(mockListSessions).toHaveBeenCalledWith({ dir: '/tmp/x', limit: 1 })
    })

    it('--continue 长 flag 同样替换', async () => {
        mockListSessions.mockResolvedValue([
            { sessionId: 'abc-123', summary: 's', lastModified: 1, cwd: '/tmp/x' },
        ])

        await expect(normalizeContinueArg(['--continue'], '/tmp/x'))
            .resolves.toEqual(['--resume', 'abc-123'])
    })

    it('-c 混在其他参数中间：仅替换 flag 位置，其余参数原序保留', async () => {
        mockListSessions.mockResolvedValue([
            { sessionId: 'abc-123', summary: 's', lastModified: 1, cwd: '/tmp/x' },
        ])

        await expect(normalizeContinueArg(['--model', 'sonnet', '-c', 'fix the bug'], '/tmp/x'))
            .resolves.toEqual(['--model', 'sonnet', '--resume', 'abc-123', 'fix the bug'])
    })

    it('多个 continue flag：首个位置替换，其余移除', async () => {
        mockListSessions.mockResolvedValue([
            { sessionId: 'abc-123', summary: 's', lastModified: 1, cwd: '/tmp/x' },
        ])

        await expect(normalizeContinueArg(['-c', '--continue'], '/tmp/x'))
            .resolves.toEqual(['--resume', 'abc-123'])
    })

    it('-c 但目录无历史会话：原样返回（保留 -c 透传给 claude 自行处理）', async () => {
        mockListSessions.mockResolvedValue([])

        await expect(normalizeContinueArg(['-c'], '/tmp/x')).resolves.toEqual(['-c'])
    })

    it('-c 且 listSessions 抛错：原样返回（降级为现状行为）', async () => {
        mockListSessions.mockRejectedValue(new Error('disk error'))

        await expect(normalizeContinueArg(['-c'], '/tmp/x')).resolves.toEqual(['-c'])
    })

    it('显式 --resume 与 -c 共存：resume 优先，原样返回不动', async () => {
        await expect(normalizeContinueArg(['--resume', 'zzz', '-c'], '/tmp/x'))
            .resolves.toEqual(['--resume', 'zzz', '-c'])
        expect(mockListSessions).not.toHaveBeenCalled()
    })

    it('-r 短 flag 与 -c 共存：同样 resume 优先不动', async () => {
        await expect(normalizeContinueArg(['-r', 'zzz', '-c'], '/tmp/x'))
            .resolves.toEqual(['-r', 'zzz', '-c'])
        expect(mockListSessions).not.toHaveBeenCalled()
    })
})
