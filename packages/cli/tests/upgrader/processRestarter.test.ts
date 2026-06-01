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
import { detectActiveProcesses, formatActiveProcessesPrompt, hasActiveProcesses, type ActiveProcesses } from '@/upgrader/processRestarter'

// mock persistence
vi.mock('@/persistence', () => ({
    readHubState: vi.fn().mockResolvedValue({ pid: 1000, listenHost: 'localhost', listenPort: 2222 }),
    readRunnerState: vi.fn().mockResolvedValue({ pid: 2000, httpPort: 3000 }),
}))

// mock process utils
vi.mock('@/utils/process', () => ({
    isProcessAlive: vi.fn().mockReturnValue(true),
    killProcess: vi.fn().mockResolvedValue(true),
}))

// mock logger
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

describe('detectActiveProcesses', () => {
    it('detects running hub and runner', async () => {
        const result = await detectActiveProcesses()
        expect(result.hub).toEqual({ pid: 1000, running: true })
        expect(result.runner).toEqual({ pid: 2000, running: true })
    })

    it('returns null when no hub state', async () => {
        const { readHubState } = await import('@/persistence')
        ;(readHubState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

        const result = await detectActiveProcesses()
        expect(result.hub).toBeNull()
    })
})

describe('formatActiveProcessesPrompt', () => {
    it('formats hub only', () => {
        const processes: ActiveProcesses = {
            hub: { pid: 1000, running: true },
            runner: null,
        }
        expect(formatActiveProcessesPrompt(processes)).toBe('Hub (PID 1000) is running. Restart now?')
    })

    it('formats hub and runner', () => {
        const processes: ActiveProcesses = {
            hub: { pid: 1000, running: true },
            runner: { pid: 2000, running: true },
        }
        expect(formatActiveProcessesPrompt(processes)).toBe('Hub (PID 1000) and Runner (PID 2000) are running. Restart now?')
    })

    it('returns empty string when no active processes', () => {
        const processes: ActiveProcesses = { hub: null, runner: null }
        expect(formatActiveProcessesPrompt(processes)).toBe('')
    })
})

describe('hasActiveProcesses', () => {
    it('returns true when hub is running', () => {
        expect(hasActiveProcesses({ hub: { pid: 1000, running: true }, runner: null })).toBe(true)
    })

    it('returns true when runner is running', () => {
        expect(hasActiveProcesses({ hub: null, runner: { pid: 2000, running: true } })).toBe(true)
    })

    it('returns false when nothing running', () => {
        expect(hasActiveProcesses({ hub: null, runner: null })).toBe(false)
    })
})
