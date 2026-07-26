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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { deriveProfileFromEnvText, findRunawayMobiProcesses } from '@/runner/doctor'

// pid 取超 PID_MAX 的 7 位数，确保不与真实进程碰撞（readRunnerPid 即便读到真实 dev
// runner pid 也不会命中这些合成 pid，测试天然隔离、无需 mock fs）
const PID_DEV_RUNNER = 1001001
const PID_DEV_HUB = 1001002
const PID_DEV_SESSION = 1001003
const PID_E2E_HUB = 1002001
const PID_DEFAULT_RUNNER = 1003001

// 合成的 mobi 进程列表（cmd 内容决定 type 归类，profile 由 attributor 决定）
const SYNTHETIC_PROCESSES = [
    { pid: PID_DEV_RUNNER, name: 'mobi', cmd: 'mobi runner start' },
    { pid: PID_DEV_HUB, name: 'mobi', cmd: 'mobi hub start' },
    { pid: PID_DEV_SESSION, name: 'mobi', cmd: 'mobi session --started-by runner' },
    { pid: PID_E2E_HUB, name: 'mobi', cmd: 'mobi hub start' },
    { pid: PID_DEFAULT_RUNNER, name: 'mobi', cmd: 'mobi runner start' },
]

vi.mock('ps-list', () => ({
    default: async () => SYNTHETIC_PROCESSES,
}))

// attributor 桩：批量按 pid 给出 profile（模拟 macOS ps -E / Linux /proc 的归属结果）
const PROFILE_BY_PID: Record<number, string> = {
    [PID_DEV_RUNNER]: 'dev',
    [PID_DEV_HUB]: 'dev',
    [PID_DEV_SESSION]: 'dev',
    [PID_E2E_HUB]: 'e2e',
    [PID_DEFAULT_RUNNER]: 'default',
}
const stubAttributor = async (pids: number[]): Promise<Map<number, string | undefined>> => {
    const result = new Map<number, string | undefined>()
    for (const pid of pids) {
        result.set(pid, PROFILE_BY_PID[pid])
    }
    return result
}

describe('deriveProfileFromEnvText', () => {
    it('Linux /proc 风格（\\0 分隔）→ 正确归约', () => {
        expect(deriveProfileFromEnvText(`PATH=/usr/bin\0MOBI_HOME=~/.mobi-dev\0HOME=/root\0`)).toBe('dev')
    })

    it('macOS ps -E 风格（空格分隔，env 追加在 command 后）→ 正确归约', () => {
        expect(deriveProfileFromEnvText('mobi hub start MOBI_HOME=/Users/x/.mobi-e2e')).toBe('e2e')
    })

    it('带 ~ 的 home 展开 → 正确归约', () => {
        expect(deriveProfileFromEnvText('mobi MOBI_HOME=~/.mobi-dev')).toBe('dev')
    })

    it('无 MOBI_HOME → default（进程未显式设 home）', () => {
        expect(deriveProfileFromEnvText('mobi hub start')).toBe('default')
    })

    it('非约定路径（无 .mobi-<name> 匹配）→ default', () => {
        expect(deriveProfileFromEnvText('mobi MOBI_HOME=/some/custom/path')).toBe('default')
    })

    it('macOS argv 含 MOBI_HOME= 字面量时，取 env 段（最后一个匹配）', () => {
        // ps -E 输出 argv 在前、env 在后。若 argv 偶然含字面量（如作为某 flag 的参数值），
        // 应取真实 env（最后的匹配），否则 profile 会被 argv 字面量污染。
        const text = 'mobi run --label XMOBI_HOME=/bad MOBI_HOME=/Users/x/.mobi-e2e'
        expect(deriveProfileFromEnvText(text)).toBe('e2e')
    })
})

describe('findRunawayMobiProcesses', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('profile=dev：只返回 dev 归属的进程，不误杀 e2e/default', async () => {
        const result = await findRunawayMobiProcesses('dev', stubAttributor)
        const pids = result.map(r => r.pid).sort()

        // dev runner / hub / session 全部命中
        expect(pids).toEqual([PID_DEV_HUB, PID_DEV_RUNNER, PID_DEV_SESSION].sort())
        // 不含 e2e / default
        expect(pids).not.toContain(PID_E2E_HUB)
        expect(pids).not.toContain(PID_DEFAULT_RUNNER)
    })

    it('profile=e2e：只返回 e2e 归属的进程', async () => {
        const result = await findRunawayMobiProcesses('e2e', stubAttributor)
        expect(result.map(r => r.pid)).toEqual([PID_E2E_HUB])
    })

    it('profile 省略 → clean all：返回全部可清理进程', async () => {
        const result = await findRunawayMobiProcesses(undefined, stubAttributor)
        const pids = result.map(r => r.pid).sort()
        expect(pids).toEqual([
            PID_DEFAULT_RUNNER, PID_DEV_HUB, PID_DEV_RUNNER, PID_DEV_SESSION, PID_E2E_HUB,
        ].sort())
    })

    it('profile=default：不误杀 dev/e2e', async () => {
        const result = await findRunawayMobiProcesses('default', stubAttributor)
        expect(result.map(r => r.pid)).toEqual([PID_DEFAULT_RUNNER])
    })
})
