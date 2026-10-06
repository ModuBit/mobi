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

import { describe, it, expect, vi } from 'vitest'
import { detectActiveProcesses, formatActiveProcessesPrompt, hasActiveProcesses, type ActiveProcesses } from '@/upgrader/processRestarter'

// mock persistence
vi.mock('@mobi/node-core/persistence', () => ({
    readDaemonState: vi.fn().mockResolvedValue({ pid: 1000, httpPort: 2222, hostPort: 12222, controlPort: 3000, startTime: 'now' }),
}))

// mock process utils
vi.mock('@mobi/node-core/utils/process', () => ({
    isProcessAlive: vi.fn().mockReturnValue(true),
    killProcess: vi.fn().mockResolvedValue(true),
}))

describe('detectActiveProcesses', () => {
    it('detects running daemon', async () => {
        const result = await detectActiveProcesses()
        expect(result.daemon).toEqual({ pid: 1000, running: true })
    })

    it('returns null when no daemon state', async () => {
        const { readDaemonState } = await import('@mobi/node-core/persistence')
        ;(readDaemonState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

        const result = await detectActiveProcesses()
        expect(result.daemon).toBeNull()
    })
})

describe('formatActiveProcessesPrompt', () => {
    it('formats running daemon', () => {
        const processes: ActiveProcesses = { daemon: { pid: 1000, running: true } }
        expect(formatActiveProcessesPrompt(processes)).toBe('Daemon (PID 1000) is running. Restart now?')
    })

    it('returns empty string when no active processes', () => {
        const processes: ActiveProcesses = { daemon: null }
        expect(formatActiveProcessesPrompt(processes)).toBe('')
    })
})

describe('hasActiveProcesses', () => {
    it('returns true when daemon is running', () => {
        expect(hasActiveProcesses({ daemon: { pid: 1000, running: true } })).toBe(true)
    })

    it('returns false when daemon not running', () => {
        expect(hasActiveProcesses({ daemon: { pid: 1000, running: false } })).toBe(false)
    })

    it('returns false when nothing running', () => {
        expect(hasActiveProcesses({ daemon: null })).toBe(false)
    })
})
