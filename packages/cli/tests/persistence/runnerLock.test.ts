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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * runner 锁自愈：EEXIST 时读锁内 PID，死 PID 删锁重试；
 * 空/损坏锁文件同样应视为陈旧锁删除——否则一个 0 字节残留锁会永久堵死所有后续 runner
 * （2026-10-02 E2E 实踩：smoke 脚本残留空锁，runner 静默 exit(0)，spawn RPC 全挂）。
 */

let home: string

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mobi-cli-runner-lock-'))
    process.env.MOBI_HOME = home
    vi.resetModules()
})

afterEach(() => {
    delete process.env.MOBI_HOME
    rmSync(home, { recursive: true, force: true })
})

async function loadLock() {
    const { acquireRunnerLock, releaseRunnerLock } = await import('@/persistence')
    return { acquireRunnerLock, releaseRunnerLock }
}

/** 获取成功后读 PID 并释放（释放会删锁文件），避免 FileHandle 被 GC 关闭触发 unhandled error */
async function acquireReadAndRelease(): Promise<{ acquired: boolean; pid: string | null }> {
    const { acquireRunnerLock, releaseRunnerLock } = await loadLock()
    const handle = await acquireRunnerLock(2, 10)
    if (!handle) return { acquired: false, pid: null }
    const pid = readLockPid()
    await releaseRunnerLock(handle)
    return { acquired: true, pid }
}

const lockFile = () => join(home, 'runner.state.json.lock')

/** 起一个立即退出的子进程，返回其（已死）PID */
function deadPid(): number {
    const child = spawnSync('true')
    return child.pid!
}

describe('acquireRunnerLock 陈旧锁自愈', () => {
    it('0 字节残留锁应被删除并成功获取', async () => {
        writeFileSync(lockFile(), '')

        const { acquired, pid } = await acquireReadAndRelease()
        expect(acquired).toBe(true)
        expect(pid).toBe(String(process.pid))
    })

    it('非数字损坏内容应被视为陈旧锁删除', async () => {
        writeFileSync(lockFile(), 'not-a-pid')

        const { acquired } = await acquireReadAndRelease()
        expect(acquired).toBe(true)
    })

    it('死 PID 锁应被删除并成功获取', async () => {
        writeFileSync(lockFile(), String(deadPid()))

        const { acquired } = await acquireReadAndRelease()
        expect(acquired).toBe(true)
    })

    it('活 PID 锁应获取失败返回 null', async () => {
        writeFileSync(lockFile(), String(process.pid))
        const { acquireRunnerLock } = await loadLock()

        const handle = await acquireRunnerLock(2, 10)

        expect(handle).toBeNull()
        expect(readLockPid()).toBe(String(process.pid))
    })
})

function readLockPid(): string {
    return readFileSync(lockFile(), 'utf-8').trim()
}
