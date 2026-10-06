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
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * daemon 锁（502：runner.state.json.lock → daemon.lock）：
 * - 陈旧锁自愈：EEXIST 时读锁内 PID，死 PID 删锁重试；空/损坏锁同样视为陈旧删除——
 *   否则一个 0 字节残留锁会永久堵死所有后续 daemon（2026-10-02 E2E 实踩：smoke 脚本
 *   残留空锁，daemon 静默 exit(0)，spawn RPC 全挂）。
 * - 旧名锁读旧（R4 防升级窗口双实例）：旧锁活 pid → 拒启；旧锁死/损坏 → 清理后接管。
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
    const { acquireDaemonLock, releaseDaemonLock } = await import('@/persistence')
    return { acquireDaemonLock, releaseDaemonLock }
}

/** 获取成功后读 PID 并释放（释放会删锁文件），避免 FileHandle 被 GC 关闭触发 unhandled error */
async function acquireReadAndRelease(): Promise<{ acquired: boolean; pid: string | null }> {
    const { acquireDaemonLock, releaseDaemonLock } = await loadLock()
    const handle = await acquireDaemonLock(2, 10)
    if (!handle) return { acquired: false, pid: null }
    const pid = readLockPid()
    await releaseDaemonLock(handle)
    return { acquired: true, pid }
}

const lockFile = () => join(home, 'daemon.lock')
const legacyLockFile = () => join(home, 'runner.state.json.lock')

/** 起一个立即退出的子进程，返回其（已死）PID */
function deadPid(): number {
    const child = spawnSync('true')
    return child.pid!
}

describe('acquireDaemonLock 陈旧锁自愈', () => {
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
        const { acquireDaemonLock } = await loadLock()

        const handle = await acquireDaemonLock(2, 10)

        expect(handle).toBeNull()
        expect(readLockPid()).toBe(String(process.pid))
    })
})

describe('acquireDaemonLock 旧名锁读旧（502 R4）', () => {
    it('旧名锁活 pid → 拒启（返回 null），旧锁文件保留（防升级窗口双 daemon）', async () => {
        writeFileSync(legacyLockFile(), String(process.pid))
        const { acquireDaemonLock } = await loadLock()

        const handle = await acquireDaemonLock(2, 10)

        expect(handle).toBeNull()
        // 旧锁文件不被误删（活进程还持有）
        expect(readFileSync(legacyLockFile(), 'utf-8').trim()).toBe(String(process.pid))
    })

    it('旧名锁死 pid → 清理旧锁并成功获取新锁', async () => {
        writeFileSync(legacyLockFile(), String(deadPid()))
        const { acquired, pid } = await acquireReadAndRelease()

        expect(acquired).toBe(true)
        expect(existsSync(legacyLockFile())).toBe(false)
        expect(pid).toBe(String(process.pid))
    })

    it('旧名锁损坏内容 → 视为死锁清理后接管', async () => {
        writeFileSync(legacyLockFile(), '')
        const { acquired } = await acquireReadAndRelease()

        expect(acquired).toBe(true)
        expect(existsSync(legacyLockFile())).toBe(false)
    })
})

function readLockPid(): string {
    return readFileSync(lockFile(), 'utf-8').trim()
}
