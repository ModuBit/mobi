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

/**
 * TerminalHost 单元行为（真 pty 由 E2E 覆盖，managerFactory 注入 fake）：
 * close 的 registry 摘除职责、pty 退出/出错经 emit 出口转发后同步摘条目、
 * 终端全空后 manager 实例回收。
 */

import { describe, expect, it } from 'vitest'
import { TerminalHost } from '../../src/terminal/TerminalHost'
import type { TerminalManagerOptions } from '../../src/terminal/TerminalManager'
import { TerminalRegistry } from '../../src/socket/terminalRegistry'

interface Harness {
    host: TerminalHost
    registry: TerminalRegistry
    emitted: Array<{ terminalId: string; event: string; payload: Record<string, unknown> }>
    /** 每次会话 manager 构造时捕获的回调（驱动 exit/error/onAllClosed 路径）；长度即构造次数 */
    captured: TerminalManagerOptions[]
}

function makeHarness(): Harness {
    const registry = new TerminalRegistry({ idleTimeoutMs: 0 })
    const emitted: Harness['emitted'] = []
    const captured: TerminalManagerOptions[] = []
    const host = new TerminalHost({
        terminalRegistry: registry,
        getSessionPath: () => '/tmp',
        emitToSocket: (terminalId, event, payload) => {
            emitted.push({ terminalId, event, payload: payload as Record<string, unknown> })
        },
        managerFactory: (options) => {
            captured.push(options)
            // 不触真 pty：fake manager 只记录操作，回调由测试直接调用
            return {
                create: () => {},
                write: () => {},
                resize: () => {},
                close: () => {},
                closeAll: () => {},
            } as never
        },
    })
    return { host, registry, emitted, captured }
}

describe('TerminalHost', () => {
    it('close：摘除 registry 条目（计数随之释放）', () => {
        const { host, registry } = makeHarness()
        registry.register('t1', 's1', 'web-1')
        expect(registry.countForSession('s1')).toBe(1)

        host.close('t1')
        expect(registry.get('t1')).toBeNull()
        expect(registry.countForSession('s1')).toBe(0)
    })

    it('closeEntries：批量关闭（web socket 断连），不动其他 socket 的终端', () => {
        const { host, registry } = makeHarness()
        const e1 = registry.register('t1', 's1', 'web-1')!
        const e2 = registry.register('t2', 's2', 'web-1')!
        registry.register('t3', 's1', 'web-2')!

        host.closeEntries([e1, e2])
        expect(registry.get('t1')).toBeNull()
        expect(registry.get('t2')).toBeNull()
        expect(registry.get('t3')).not.toBeNull()
    })

    it('write/resize 对无 registry 条目的 terminalId 是 no-op', () => {
        const { host } = makeHarness()
        expect(() => host.write('ghost', 'x')).not.toThrow()
        expect(() => host.resize('ghost', 80, 24)).not.toThrow()
    })

    it('create：同一会话复用 manager（factory 只构造一次），选项接线（idle 关闭 + cwd getter）', () => {
        const { host, registry, captured } = makeHarness()
        registry.register('t1', 's1', 'web-1')
        host.create('s1', 't1', 80, 24)
        registry.register('t2', 's1', 'web-1')
        host.create('s1', 't2', 80, 24)

        expect(captured.length).toBe(1)
        expect(captured[0].sessionId).toBe('s1')
        expect(captured[0].idleTimeoutMs).toBe(0) // 空闲计时单源在 registry
        expect(captured[0].getSessionPath()).toBe('/tmp')
    })

    it('pty 退出（onExit）：exit 事件经 emit 出口转发后摘条目（计数释放）', () => {
        const { host, registry, emitted, captured } = makeHarness()
        registry.register('t1', 's1', 'web-1')
        host.create('s1', 't1', 80, 24)

        captured[0].onExit({ sessionId: 's1', terminalId: 't1', code: 0, signal: null })
        expect(emitted).toEqual([{
            terminalId: 't1',
            event: 'terminal:exit',
            payload: { sessionId: 's1', terminalId: 't1', code: 0, signal: null },
        }])
        expect(registry.get('t1')).toBeNull()
    })

    it('pty 出错（onError）：error 事件转发后摘条目（防 web 无限重连循环）', () => {
        const { host, registry, emitted, captured } = makeHarness()
        registry.register('t1', 's1', 'web-1')
        host.create('s1', 't1', 80, 24)

        captured[0].onError({ sessionId: 's1', terminalId: 't1', message: 'boom' })
        expect(emitted[0].event).toBe('terminal:error')
        expect(registry.get('t1')).toBeNull()
    })

    it('终端全空（onAllClosed）：manager 实例回收，下次 create 重新构造', () => {
        const { host, registry, captured } = makeHarness()
        registry.register('t1', 's1', 'web-1')
        host.create('s1', 't1', 80, 24)

        captured[0].onAllClosed?.()
        registry.register('t2', 's1', 'web-1')
        host.create('s1', 't2', 80, 24)
        expect(captured.length).toBe(2)
    })
})
