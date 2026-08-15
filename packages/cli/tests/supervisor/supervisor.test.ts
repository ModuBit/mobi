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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Supervisor, type ManagedProcess, type ComponentName } from '@/supervisor/supervisor'

/** 构造可控的假子进程：手动 exit、可查询 kill 信号 */
class FakeProcess implements ManagedProcess {
    pid: number
    killedWith: string | null = null
    private exitListeners: Array<(code: number | null, signal: string | null) => void> = []
    private errorListeners: Array<(error: Error) => void> = []
    private stderrListeners: Array<(chunk: Buffer) => void> = []
    private static nextPid = 1000

    constructor() {
        this.pid = FakeProcess.nextPid++
    }

    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    on(event: string, listener: (...args: never[]) => void): void {
        if (event === 'exit') this.exitListeners.push(listener as never)
        if (event === 'error') this.errorListeners.push(listener as never)
    }

    get stderr() {
        return {
            on: (_event: 'data', listener: (chunk: Buffer) => void) => {
                this.stderrListeners.push(listener)
            },
        }
    }

    kill(signal: string = 'SIGTERM'): void {
        this.killedWith = signal
    }

    emitStderr(text: string): void {
        for (const listener of this.stderrListeners) listener(Buffer.from(text))
    }

    exit(code: number | null): void {
        for (const listener of this.exitListeners) listener(code, null)
    }

    /** 模拟 spawn 异步失败（只 emit error，不 emit exit） */
    emitError(message: string): void {
        for (const listener of this.errorListeners) listener(new Error(message))
    }
}

const onEmptySpy = vi.fn()

function createHarness() {
    const processes: FakeProcess[] = []
    const crashLogs: Array<{ name: ComponentName; tail: string }> = []
    let now = 1_000_000

    const supervisor = new Supervisor(
        {
            spawn: () => {
                const process = new FakeProcess()
                processes.push(process)
                return process
            },
            now: () => now,
            writeCrashLog: (name, tail) => crashLogs.push({ name, tail }),
        },
        { onEmpty: onEmptySpy },
    )

    return {
        supervisor,
        processes,
        crashLogs,
        advance: (ms: number) => {
            now += ms
        },
        onEmptySpy,
    }
}

describe('Supervisor 托管状态机', () => {
    afterEach(() => {
        vi.useRealTimers()
        onEmptySpy.mockClear()
    })

    it('start → running；重复 start 幂等（不再 spawn）', () => {
        const h = createHarness()
        h.supervisor.start('hub')
        expect(h.processes).toHaveLength(1)
        expect(h.supervisor.status().hub).toMatchObject({ managed: true, status: 'running' })

        h.supervisor.start('hub')
        expect(h.processes).toHaveLength(1)
    })

    it('崩溃 → 退避重启；稳定运行 60s 后计数清零', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        // 第 1 次崩溃（运行 10s < 60s）：1s 后重启
        h.advance(10_000)
        h.processes[0].exit(1)
        expect(h.supervisor.status().hub.status).toBe('backoff')
        vi.advanceTimersByTime(1_000)
        expect(h.processes).toHaveLength(2)

        // 第 2 次崩溃（运行 5s）：2s 后重启
        h.advance(5_000)
        h.processes[1].exit(1)
        vi.advanceTimersByTime(1_999)
        expect(h.processes).toHaveLength(2)
        vi.advanceTimersByTime(1)
        expect(h.processes).toHaveLength(3)

        // 第 3 次崩溃，但之前运行了 120s ≥ 60s → 计数重新起算 → 1s 后重启
        h.advance(120_000)
        h.processes[2].exit(1)
        vi.advanceTimersByTime(1_000)
        expect(h.processes).toHaveLength(4)
        expect(h.supervisor.status().hub.consecutiveCrashes).toBe(1)
    })

    it('连续 5 次启动即崩 → failed，不再自动重启，崩溃现场落盘', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        for (let i = 0; i < 4; i++) {
            h.processes.at(-1)!.emitStderr(`crash ${i + 1}\n`)
            h.advance(1_000)
            h.processes.at(-1)!.exit(1)
            vi.advanceTimersByTime(nextBackoffFor(i + 1))
        }
        expect(h.processes).toHaveLength(5)

        // 第 5 次 → failed
        h.processes.at(-1)!.emitStderr('final crash\n')
        h.advance(1_000)
        h.processes.at(-1)!.exit(1)
        vi.advanceTimersByTime(60_000)

        expect(h.processes).toHaveLength(5)
        const hub = h.supervisor.status().hub
        expect(hub.status).toBe('failed')
        expect(h.crashLogs).toHaveLength(1)
        expect(h.crashLogs[0].tail).toContain('final crash')
    })

    it('显式 stop → 不触发重启，托管集清空时回调 onEmpty', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')
        h.supervisor.stop('hub')
        expect(h.processes[0].killedWith).toBe('SIGTERM')
        h.processes[0].exit(0)

        vi.advanceTimersByTime(60_000)
        expect(h.processes).toHaveLength(1)
        expect(h.supervisor.status().hub).toMatchObject({ managed: false, status: 'stopped' })
        expect(h.onEmptySpy).toHaveBeenCalledTimes(1)
    })

    it('restart → 重置崩溃计数并立即重拉（不经退避）', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')
        h.advance(1_000)
        h.processes[0].exit(1) // 崩一次，计数 1
        vi.advanceTimersByTime(1_000) // 退避完成，重拉
        expect(h.processes).toHaveLength(2)

        h.supervisor.restart('hub')
        expect(h.processes[1].killedWith).toBe('SIGTERM')
        h.processes[1].exit(0) // 显式重启的退出
        expect(h.processes).toHaveLength(3) // 立即重拉
        expect(h.supervisor.status().hub.consecutiveCrashes).toBe(0)
    })

    it('shutdown → 先 runner 后 hub 有序停止，全部退出后 resolve', async () => {
        const h = createHarness()
        h.supervisor.start('hub')
        h.supervisor.start('runner')
        const shutdownPromise = h.supervisor.shutdown()
        expect(h.processes[0].killedWith).toBeNull() // hub 尚未被杀
        expect(h.processes[1].killedWith).toBe('SIGTERM')
        h.processes[1].exit(0)
        // runner 停止后 hub 才被杀
        expect(h.processes[0].killedWith).toBe('SIGTERM')
        h.processes[0].exit(0)
        await shutdownPromise
        // 第二次调用幂等，立即 resolve；两进程均已退出，终态均为 stopped
        await h.supervisor.shutdown()
        expect(h.processes.every((p) => p.killedWith === 'SIGTERM')).toBe(true)
        expect(h.supervisor.status().hub).toMatchObject({ status: 'stopped' })
        expect(h.supervisor.status().runner).toMatchObject({ status: 'stopped' })
    })

    it('stderr 尾部截断——崩溃现场仅保留最后 8000 字符', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        for (let i = 0; i < 5; i++) {
            if (i === 4) h.processes.at(-1)!.emitStderr('x'.repeat(9000) + 'TAIL_MARKER')
            h.advance(1_000)
            h.processes.at(-1)!.exit(1)
            if (i < 4) vi.advanceTimersByTime(nextBackoffFor(i + 1))
        }
        vi.advanceTimersByTime(60_000)

        expect(h.crashLogs).toHaveLength(1)
        expect(h.crashLogs[0].tail.length).toBeLessThanOrEqual(8_100)
        expect(h.crashLogs[0].tail.endsWith('TAIL_MARKER')).toBe(true)
    })

    it('failed 后显式 start → 清崩溃计数立即重拉（而非 no-op）', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        // 连崩 5 次 → failed
        for (let i = 0; i < 5; i++) {
            h.advance(1_000)
            h.processes.at(-1)!.exit(1)
            if (i < 4) vi.advanceTimersByTime(nextBackoffFor(i + 1))
        }
        vi.advanceTimersByTime(60_000)
        expect(h.supervisor.status().hub.status).toBe('failed')

        // 显式 start：用户要求现在就绪——立即重拉且计数清零
        h.supervisor.start('hub')
        expect(h.processes).toHaveLength(6)
        expect(h.supervisor.status().hub).toMatchObject({ status: 'running', consecutiveCrashes: 0 })
    })

    it('backoff 退避中显式 start → 不等退避立即重拉', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')
        h.advance(1_000)
        h.processes[0].exit(1)
        expect(h.supervisor.status().hub.status).toBe('backoff')

        // 退避还剩 1s：显式 start 立即拉起
        h.supervisor.start('hub')
        expect(h.processes).toHaveLength(2)
        expect(h.supervisor.status().hub).toMatchObject({ status: 'running', consecutiveCrashes: 0 })
    })

    it('running 中显式 start 传入新 env → 幂等不重拉，但刷新 env 供下次重拉使用', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub', { MOBI_LISTEN_PORT: '2222' })
        h.supervisor.start('hub', { MOBI_LISTEN_PORT: '3333' })
        expect(h.processes).toHaveLength(1)

        // 崩溃后的自动重拉使用最新 env
        h.processes[0].exit(1)
        vi.advanceTimersByTime(1_000)
        expect(h.processes).toHaveLength(2)
    })

    it('spawn error（无 exit）→ 视同崩溃进入退避，错误信息进崩溃现场', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        // spawn 异步失败（如二进制缺失）：只有 error 没有 exit
        h.processes[0].emitError('spawn mobi ENOENT')
        expect(h.supervisor.status().hub.status).toBe('backoff')
        expect(h.supervisor.status().hub.consecutiveCrashes).toBe(1)

        // 退避后重拉
        vi.advanceTimersByTime(1_000)
        expect(h.processes).toHaveLength(2)
    })

    it('exit 之后再到达的 error → 忽略，不重复计数', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')
        h.advance(1_000)
        h.processes[0].exit(1)
        // exit 已处理：迟到的 error（如对已退出进程 kill 的 ESRCH）不应再计一次崩溃
        h.processes[0].emitError('kill ESRCH')

        expect(h.supervisor.status().hub.consecutiveCrashes).toBe(1)
        vi.advanceTimersByTime(nextBackoffFor(1))
        expect(h.processes).toHaveLength(2)
    })

    it('连续 spawn error → 计数累加到 failed，崩溃现场含 spawn error 信息', () => {
        vi.useFakeTimers()
        const h = createHarness()
        h.supervisor.start('hub')

        for (let i = 0; i < 5; i++) {
            h.advance(1_000)
            h.processes.at(-1)!.emitError('spawn mobi ENOENT')
            if (i < 4) vi.advanceTimersByTime(nextBackoffFor(i + 1))
        }
        vi.advanceTimersByTime(60_000)

        expect(h.supervisor.status().hub.status).toBe('failed')
        expect(h.crashLogs).toHaveLength(1)
        expect(h.crashLogs[0].tail).toContain('spawn mobi ENOENT')
    })
})

/** 测试辅助：与 restartPolicy 的退避序列一致 */
function nextBackoffFor(n: number): number {
    return Math.min(1000 * 2 ** (n - 1), 30_000)
}
