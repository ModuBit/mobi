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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installExitLogger,
  installExitHandlers,
  resolveMobiLogsDir,
  readExitRecords,
  isProcessAlive
} from '../src/exitLogger'

let logsDir: string

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), 'mobi-exit-'))
})

afterEach(() => {
  rmSync(logsDir, { recursive: true, force: true })
})

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('exitLogger recordExit', () => {
  it('追加一条 JSONL 记录到 exits.log', () => {
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({ reason: 'normal', exitCode: 0 })

    const records = readExitRecords(logsDir)
    expect(records).toHaveLength(1)
    expect(records[0].processType).toBe('hub')
    expect(records[0].reason).toBe('normal')
    expect(records[0].exitCode).toBe(0)
    expect(records[0].pid).toBe(process.pid)
    expect(typeof records[0].timestamp).toBe('string')
  })

  it('多次退出追加多行，不覆盖', () => {
    // 每个进程一个 logger 实例（recordExit 单实例幂等），验证 exits.log 跨实例累积
    installExitLogger('runner', { logsDir }).recordExit({ reason: 'signal-term', signal: 'SIGTERM' })
    installExitLogger('runner', { logsDir }).recordExit({ reason: 'normal', exitCode: 0 })

    const records = readExitRecords(logsDir)
    expect(records).toHaveLength(2)
    expect(records[0].reason).toBe('signal-term')
  })

  it('exits.log 超过 maxRollSize 时滚动，保留 maxRollCount 个', () => {
    // 多个进程实例累积写入，触发滚动
    for (let i = 0; i < 20; i++) {
      installExitLogger('hub', { logsDir, maxRollSize: 200, maxRollCount: 2 }).recordExit({ reason: 'normal', exitCode: 0 })
    }

    expect(existsSync(join(logsDir, 'exits.log'))).toBe(true)
    expect(existsSync(join(logsDir, 'exits.log.1'))).toBe(true)
    // 超过 maxRollCount 的旧文件被删除
    expect(existsSync(join(logsDir, 'exits.log.3'))).toBe(false)
  })

  it('recordExit 幂等：同一 logger 实例只记一次', () => {
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({ reason: 'crash-uncaught', errorMessage: 'boom' })
    // crash 之后的 exit 事件不应再记
    logger.recordExit({ reason: 'normal', exitCode: 0 })

    const records = readExitRecords(logsDir)
    expect(records).toHaveLength(1)
    expect(records[0].reason).toBe('crash-uncaught')
  })

  it('recordExit 记录父进程谱系（ppid + parentCommand）', () => {
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({ reason: 'normal', exitCode: 0 })

    const records = readExitRecords(logsDir)
    expect(records[0].ppid).toBe(process.ppid)
    // parentCommand 可能为 null（受限环境），但类型必须存在
    expect('parentCommand' in records[0]).toBe(true)
  })
})

describe('exitLogger 前向兼容', () => {
  it('readExitRecords 解析无 ppid/parentCommand 的旧记录时补 null', () => {
    const oldRecord = {
      timestamp: '2026-07-20T00:00:00.000Z',
      processType: 'hub',
      pid: 12345,
      exitCode: 143,
      signal: 'SIGTERM',
      reason: 'signal-term',
      errorMessage: null,
      stackHead: null,
      uptimeMs: 1000,
      peakMemoryMb: 100,
      dumpFile: null
    }
    writeFileSync(join(logsDir, 'exits.log'), JSON.stringify(oldRecord) + '\n', 'utf-8')

    const records = readExitRecords(logsDir)
    expect(records).toHaveLength(1)
    expect(records[0].ppid).toBeNull()
    expect(records[0].parentCommand).toBeNull()
    expect(records[0].reason).toBe('signal-term')
  })
})

describe('exitLogger dump', () => {
  it('crash 时写 dump json 到 dumps/，文件名含 processType 和 pid', () => {
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({
      reason: 'crash-uncaught',
      errorMessage: 'boom',
      stack: 'Error: boom\n    at foo:1:1'
    })

    const dumps = readdirSync(join(logsDir, 'dumps')).filter(f => f.endsWith('.json'))
    expect(dumps.length).toBe(1)
    expect(dumps[0]).toContain('hub')
    expect(dumps[0]).toContain(`pid-${process.pid}`)

    const payload = readJson(join(logsDir, 'dumps', dumps[0])) as Record<string, unknown>
    expect(payload.errorMessage).toBe('boom')
    expect(payload.fullStack).toContain('Error: boom')
  })

  it('crash 时 dump 含注入的 ring buffer 内容', () => {
    const ring = { snapshot: () => ['line-A', 'line-B'] }
    const logger = installExitLogger('runner', { logsDir, ringBuffer: ring })
    logger.recordExit({ reason: 'crash-unhandled', errorMessage: 'x' })

    const dumps = readdirSync(join(logsDir, 'dumps')).filter(f => f.endsWith('.json'))
    const payload = readJson(join(logsDir, 'dumps', dumps[0])) as { recentLogs: string[] }
    expect(payload.recentLogs).toEqual(['line-A', 'line-B'])
  })

  it('非 crash reason 不写 dump', () => {
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({ reason: 'signal-term', signal: 'SIGTERM' })
    expect(readdirSync(join(logsDir, 'dumps')).length).toBe(0)
  })

  it('dump 的 env 仅含安全键，不含 token 类变量', () => {
    process.env.MOBI_FAKE_SECRET = 'shhh'
    const logger = installExitLogger('hub', { logsDir })
    logger.recordExit({ reason: 'crash-uncaught', errorMessage: 'x' })
    delete process.env.MOBI_FAKE_SECRET

    const dumps = readdirSync(join(logsDir, 'dumps')).filter(f => f.endsWith('.json'))
    const payload = readJson(join(logsDir, 'dumps', dumps[0])) as { env: Record<string, unknown> }
    expect(JSON.stringify(payload.env)).not.toContain('shhh')
    expect(payload.env).not.toHaveProperty('MOBI_FAKE_SECRET')
  })
})

describe('exitLogger recordExternalKill', () => {
  it('补记一条 killed-externally，不受 alreadyRecorded 幂等约束', () => {
    const logger = installExitLogger('hub', { logsDir })
    // 即使之前已 recordExit，兜底记录仍应写入
    logger.recordExit({ reason: 'normal', exitCode: 0 })
    logger.recordExternalKill(99999, '2026-07-20T00:00:00Z')

    const records = readExitRecords(logsDir)
    expect(records).toHaveLength(2)
    const killed = records.find(r => r.reason === 'killed-externally')
    expect(killed).toBeDefined()
    expect(killed!.pid).toBe(99999)
    expect(killed!.errorMessage).toContain('99999')
  })
})

describe('resolveMobiLogsDir', () => {
  it('MOBI_HOME 设置时返回其下的 logs', () => {
    const prev = process.env.MOBI_HOME
    process.env.MOBI_HOME = '/tmp/fake-mobi-home'
    try {
      expect(resolveMobiLogsDir()).toBe(join('/tmp/fake-mobi-home', 'logs'))
    } finally {
      if (prev === undefined) delete process.env.MOBI_HOME
      else process.env.MOBI_HOME = prev
    }
  })
})

describe('installExitHandlers', () => {
  it('是可调用函数，调用不抛', () => {
    expect(typeof installExitHandlers).toBe('function')
    const logger = installExitLogger('cli', { logsDir })
    expect(() => installExitHandlers('cli', logger)).not.toThrow()
  })

  it('支持 exitOnSignal 选项', () => {
    const logger = installExitLogger('cli', { logsDir })
    expect(() => installExitHandlers('cli', logger, undefined, { exitOnSignal: true })).not.toThrow()
  })

  it('onExitSync 正常退出收到 { crashed: false }', () => {
    const logger = installExitLogger('hub', { logsDir })
    const spy = vi.fn()
    installExitHandlers('hub', logger, undefined, { onExitSync: spy })
    // process.emit('exit', code) 同步触发 exit listener，不真正退出进程
    process.emit('exit', 0)
    expect(spy).toHaveBeenCalledWith({ crashed: false })
  })

  it('onExitSync 崩溃退出收到 { crashed: true }（hub 据此跳过 clearHubState 保留痕迹）', () => {
    const logger = installExitLogger('hub', { logsDir })
    const spy = vi.fn()
    // 屏蔽其它 uncaughtException 监听（含 vitest 自身），仅让本安装的 handler 跑
    const origListeners = process.listeners('uncaughtException')
    process.removeAllListeners('uncaughtException')
    // handler 内会 process.exit(1)，mock 成 no-op 避免真正退出测试进程
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    try {
      installExitHandlers('hub', logger, undefined, { onExitSync: spy })
      process.emit('uncaughtException', new Error('boom'))
      process.emit('exit', 1)
      expect(spy).toHaveBeenCalledWith({ crashed: true })
    } finally {
      exitSpy.mockRestore()
      process.removeAllListeners('uncaughtException')
      for (const l of origListeners) process.on('uncaughtException', l as (...a: unknown[]) => void)
    }
  })
})

describe('isProcessAlive', () => {
  it('自身 pid 存活', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })
  it('无效/不存在的 pid 不存活', () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})
