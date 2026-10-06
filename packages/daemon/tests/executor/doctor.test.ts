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
import { deriveProfileFromEnvText, findAllMobiProcesses, findRunawayMobiProcesses } from '@/executor/doctor'

// pid 取超 PID_MAX 的 7 位数，确保不与真实进程碰撞（readRunnerPid 即便读到真实 dev
// daemon pid 也不会命中这些合成 pid，测试天然隔离、无需 mock fs）
const PID_DEV_RUNNER = 1001001
const PID_DEV_HUB = 1001002
const PID_DEV_SESSION = 1001003
const PID_DEV_SUPERVISOR = 1001004
const PID_DEV_VERSION_CHECK = 1001005
const PID_E2E_SUPERVISOR = 1002002
const PID_E2E_VERSION_CHECK = 1002005
const PID_DEFAULT_DAEMON = 1003001
const PID_E2E_DAEMON = 1002003
const PID_DEV_DAEMON = 1002004

// 合成的 mobi 进程列表（cmd 内容决定 type 归类，profile 由 attributor 决定）
const SYNTHETIC_PROCESSES = [
    // 历史 hub/runner start 形态：识别集合已收敛（remove-machine 601），
    // 落 user-session 兜底、不再被 doctor clean 认领
    { pid: PID_DEV_RUNNER, name: 'mobi', cmd: 'mobi runner start' },
    { pid: PID_DEV_HUB, name: 'mobi', cmd: 'mobi hub start' },
    { pid: PID_DEV_SESSION, name: 'mobi', cmd: 'mobi session --started-by daemon' },
    { pid: PID_DEV_SUPERVISOR, name: 'bun', cmd: 'bun src/index.ts service supervise --sync' },
    { pid: PID_DEV_VERSION_CHECK, name: 'mobi', cmd: 'mobi --version' },
    { pid: PID_E2E_SUPERVISOR, name: 'mobi', cmd: 'mobi service supervise --sync' },
    { pid: PID_E2E_VERSION_CHECK, name: 'mobi', cmd: 'mobi --version' },
    { pid: PID_DEFAULT_DAEMON, name: 'mobi', cmd: 'mobi daemon start-sync' },
    // 标准单机 daemon 进程形态（源码直跑 / 二进制两种）
    { pid: PID_E2E_DAEMON, name: 'bun', cmd: 'bun src/index.ts daemon start-sync --host 127.0.0.1 --port 2224' },
    { pid: PID_DEV_DAEMON, name: 'mobi', cmd: 'mobi daemon start-sync' },
]

vi.mock('ps-list', () => ({
    default: async () => SYNTHETIC_PROCESSES,
}))

// attributor 桩：批量按 pid 给出 profile（模拟 macOS ps -E / Linux /proc 的归属结果）
const PROFILE_BY_PID: Record<number, string> = {
    [PID_DEV_RUNNER]: 'dev',
    [PID_DEV_HUB]: 'dev',
    [PID_DEV_SESSION]: 'dev',
    [PID_DEV_SUPERVISOR]: 'dev',
    [PID_DEV_VERSION_CHECK]: 'dev',
    [PID_E2E_SUPERVISOR]: 'e2e',
    [PID_E2E_VERSION_CHECK]: 'e2e',
    [PID_DEFAULT_DAEMON]: 'default',
    [PID_E2E_DAEMON]: 'e2e',
    [PID_DEV_DAEMON]: 'dev',
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

    it('profile=dev：只返回 dev 归属的可清理进程，不误杀 e2e/default', async () => {
        const result = await findRunawayMobiProcesses('dev', stubAttributor)
        const pids = result.map(r => r.pid).sort()

        // dev session（spawned）/ supervisor / version-check / daemon 全部命中
        expect(pids).toEqual(
            [PID_DEV_SESSION, PID_DEV_SUPERVISOR, PID_DEV_VERSION_CHECK, PID_DEV_DAEMON].sort(),
        )
        // 不含 e2e / default
        expect(pids).not.toContain(PID_E2E_SUPERVISOR)
        expect(pids).not.toContain(PID_E2E_VERSION_CHECK)
        expect(pids).not.toContain(PID_DEFAULT_DAEMON)
    })

    it('profile=e2e：只返回 e2e 归属的进程（含 daemon 进程形态）', async () => {
        const result = await findRunawayMobiProcesses('e2e', stubAttributor)
        expect(result.map(r => r.pid).sort()).toEqual(
            [PID_E2E_SUPERVISOR, PID_E2E_VERSION_CHECK, PID_E2E_DAEMON].sort(),
        )
        const classified = await findAllMobiProcesses(stubAttributor)
        expect(classified.find(p => p.pid === PID_E2E_DAEMON)?.type).toBe('dev-daemon')
    })

    it('daemon start-sync 进程形态被识别为 daemon/dev-daemon（不落 user-session）', async () => {
        const classified = await findAllMobiProcesses(stubAttributor)
        const byPid = new Map(classified.map(r => [r.pid, r.type]))
        // 源码直跑（cmd 含 src/index.ts）→ dev-daemon；二进制形态 → daemon
        expect(byPid.get(PID_E2E_DAEMON)).toBe('dev-daemon')
        expect(byPid.get(PID_DEV_DAEMON)).toBe('daemon')
    })

    it('识别集合收敛（601）：历史 hub/runner start 形态落 user-session 不可清理，spawned-session/version-check 可清理', async () => {
        const classified = await findAllMobiProcesses(stubAttributor)
        const byPid = new Map(classified.map(r => [r.pid, r.type]))
        // 历史形态 → user-session 兜底
        expect(byPid.get(PID_DEV_RUNNER)).toBe('user-session')
        expect(byPid.get(PID_DEV_HUB)).toBe('user-session')
        // 存活识别类型改名收敛
        expect(byPid.get(PID_DEV_SESSION)).toBe('spawned-session')
        expect(byPid.get(PID_DEV_VERSION_CHECK)).toBe('version-check')
        expect(byPid.get(PID_E2E_VERSION_CHECK)).toBe('version-check')

        const cleanable = new Set((await findRunawayMobiProcesses(undefined, stubAttributor)).map(r => r.pid))
        expect(cleanable.has(PID_DEV_RUNNER)).toBe(false)
        expect(cleanable.has(PID_DEV_HUB)).toBe(false)
    })

    it('profile 省略 → clean all：返回全部可清理进程（含 supervisor/daemon/version-check/spawned-session）', async () => {
        const result = await findRunawayMobiProcesses(undefined, stubAttributor)
        const pids = result.map(r => r.pid).sort()
        expect(pids).toEqual([
            PID_DEV_SESSION, PID_DEV_SUPERVISOR, PID_DEV_VERSION_CHECK,
            PID_E2E_SUPERVISOR, PID_E2E_VERSION_CHECK,
            PID_DEFAULT_DAEMON, PID_E2E_DAEMON, PID_DEV_DAEMON,
        ].sort())
    })

    it('profile=default：不误杀 dev/e2e', async () => {
        const result = await findRunawayMobiProcesses('default', stubAttributor)
        expect(result.map(r => r.pid)).toEqual([PID_DEFAULT_DAEMON])
    })
})
