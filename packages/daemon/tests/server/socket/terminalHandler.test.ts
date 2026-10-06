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

import { describe, test, expect, mock } from 'bun:test'
import { registerTerminalHandlers } from '../../../src/socket/handlers/terminal'
import { TerminalRegistry } from '../../../src/socket/terminalRegistry'
import type { TerminalHost } from '../../../src/terminal/TerminalHost'

/** 构造一个 mock web socket（terminal namespace 客户端） */
function makeSocket(id: string, namespace = 'ns') {
    const handlers = new Map<string, ((...args: unknown[]) => void)>()
    return {
        id,
        data: { namespace },
        on: mock((ev: string, h: (...args: unknown[]) => void) => {
            handlers.set(ev, h)
        }),
        emit: mock(() => {}),
        _handlers: handlers,
    } as unknown as {
        id: string
        emit: ReturnType<typeof mock>
        _handlers: Map<string, (...args: unknown[]) => void>
    }
}

/** 记录调用的 TerminalHost 替身（handler 层测注册/上限/归属，真实 pty 由 E2E 覆盖） */
function makeHost() {
    return {
        create: mock(() => {}),
        write: mock(() => {}),
        resize: mock(() => {}),
        close: mock(() => {}),
        closeEntries: mock(() => {}),
    }
}

function makeDeps() {
    return {
        // daemon 持有形态：getSession 只回答归属（无 active——休眠会话开终端照常成功）
        getSession: mock(() => ({ namespace: 'ns' })),
        terminalRegistry: new TerminalRegistry({ idleTimeoutMs: 0 }),
        terminalHost: makeHost() as unknown as TerminalHost,
        maxTerminalsPerSocket: 3,
        maxTerminalsPerSession: 3,
    }
}

const PAYLOAD = { sessionId: 's1', terminalId: 't1', cols: 80, rows: 24 }

describe('terminal:create（pty 由 daemon 持有）', () => {
    test('成功：直调 host.create，无 error', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)
        expect(deps.terminalHost.create).toHaveBeenCalledWith('s1', 't1', 80, 24)
        expect(web.emit).not.toHaveBeenCalled()
    })

    test('同一 web socket 重连（重发 create）：成功，不报 already in use', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)
        web.emit.mockClear()

        web._handlers.get('terminal:create')!(PAYLOAD)
        expect(deps.terminalHost.create).toHaveBeenCalledTimes(2)
        expect(web.emit).not.toHaveBeenCalled()
    })

    test('不同 web socket create 已占用的 terminalId：报 already in use', () => {
        const deps = makeDeps()
        const web1 = makeSocket('web-1')
        registerTerminalHandlers(web1 as never, deps as never)
        web1._handlers.get('terminal:create')!(PAYLOAD)

        const web2 = makeSocket('web-2')
        registerTerminalHandlers(web2 as never, deps as never)
        web2._handlers.get('terminal:create')!(PAYLOAD)
        expect(web2.emit).toHaveBeenCalledWith(
            'terminal:error',
            expect.objectContaining({ message: 'Terminal ID is already in use.' }),
        )
    })

    test('达 session 上限（3）：第 4 个 terminalId 被拒', () => {
        const deps = makeDeps()
        const mk = (id: string, tid: string) => {
            const web = makeSocket(id)
            registerTerminalHandlers(web as never, deps as never)
            web._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: tid, cols: 80, rows: 24 })
            return web
        }
        mk('web-1', 't1')
        mk('web-2', 't2')
        mk('web-3', 't3')

        const web4 = mk('web-4', 't4')
        expect(web4.emit).toHaveBeenCalledWith(
            'terminal:error',
            expect.objectContaining({ message: 'Too many terminals open for this session (max 3).' }),
        )
        expect(deps.terminalHost.create).toHaveBeenCalledTimes(3)
    })

    test('达 session 上限（3）时同 socket 重连：先清旧 entry 再过上限检查，成功', () => {
        const deps = makeDeps()
        const mk = (id: string, tid: string) => {
            const web = makeSocket(id)
            registerTerminalHandlers(web as never, deps as never)
            web._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: tid, cols: 80, rows: 24 })
            return web
        }
        const web1 = mk('web-1', 't1')
        mk('web-2', 't2')
        mk('web-3', 't3')
        web1.emit.mockClear()

        // web1 重连 t1（同 socket 重发 create）：旧 entry 先清，不触发 too many
        web1._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: 't1', cols: 80, rows: 24 })
        expect(web1.emit).not.toHaveBeenCalled()
        expect(deps.terminalHost.create).toHaveBeenCalledTimes(4)
    })

    test('休眠（inactive）会话 create 照常成功——终端与会话进程解耦，不触发唤醒', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)
        expect(deps.terminalHost.create).toHaveBeenCalledWith('s1', 't1', 80, 24)
        expect(web.emit).not.toHaveBeenCalled()
    })
})

describe('terminal:write / resize / close', () => {
    test('write/resize 直调 host（经 registry 归属校验）', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)

        web._handlers.get('terminal:write')!({ terminalId: 't1', data: 'ls\n' })
        expect(deps.terminalHost.write).toHaveBeenCalledWith('t1', 'ls\n')

        web._handlers.get('terminal:resize')!({ terminalId: 't1', cols: 120, rows: 40 })
        expect(deps.terminalHost.resize).toHaveBeenCalledWith('t1', 120, 40)
    })

    test('非持有 socket 的 write 被忽略（归属校验）', () => {
        const deps = makeDeps()
        const web1 = makeSocket('web-1')
        registerTerminalHandlers(web1 as never, deps as never)
        web1._handlers.get('terminal:create')!(PAYLOAD)

        const web2 = makeSocket('web-2')
        registerTerminalHandlers(web2 as never, deps as never)
        web2._handlers.get('terminal:write')!({ terminalId: 't1', data: 'ls\n' })
        expect(deps.terminalHost.write).not.toHaveBeenCalled()
    })

    test('close：直调 host.close（registry 摘除由 host 负责，TerminalHost 单测锁定）', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)

        web._handlers.get('terminal:close')!({ terminalId: 't1' })
        expect(deps.terminalHost.close).toHaveBeenCalledWith('t1')

        // 重开：不再被 already in use 拦
        web.emit.mockClear()
        web._handlers.get('terminal:create')!(PAYLOAD)
        expect(web.emit).not.toHaveBeenCalled()
    })

    test('disconnect：该 socket 名下终端批量关闭', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: 't1', cols: 80, rows: 24 })
        web._handlers.get('terminal:create')!({ sessionId: 's2', terminalId: 't2', cols: 80, rows: 24 })

        web._handlers.get('disconnect')!()
        expect(deps.terminalHost.closeEntries).toHaveBeenCalledTimes(1)
        const entries = (deps.terminalHost.closeEntries as ReturnType<typeof mock>).mock.calls[0][0]
        expect(entries.map((e: { terminalId: string }) => e.terminalId).sort()).toEqual(['t1', 't2'])
        expect(deps.terminalRegistry.countForSocket('web-1')).toBe(0)
    })
})

describe('TerminalRegistry 空闲回收（计时单源）', () => {
    test('空闲到点：onIdle 回调后条目自动移除', async () => {
        const onIdle = mock(() => {})
        const registry = new TerminalRegistry({ idleTimeoutMs: 20, onIdle })
        registry.register('t1', 's1', 'web-1')
        await new Promise((r) => setTimeout(r, 60))
        expect(onIdle).toHaveBeenCalledTimes(1)
        expect(registry.get('t1')).toBeNull()
    })

    test('markActivity 重置计时', async () => {
        const onIdle = mock(() => {})
        const registry = new TerminalRegistry({ idleTimeoutMs: 40, onIdle })
        registry.register('t1', 's1', 'web-1')
        await new Promise((r) => setTimeout(r, 25))
        registry.markActivity('t1')
        await new Promise((r) => setTimeout(r, 25))
        expect(onIdle).not.toHaveBeenCalled()
    })
})
