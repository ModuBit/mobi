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
import { registerTerminalHandlers } from '../../src/socket/handlers/terminal'
import { TerminalRegistry } from '../../src/socket/terminalRegistry'

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

/** 构造 handler deps（含一个 mock CLI socket，归属于 session:s1 房间） */
function makeDeps() {
    const cliSocket = { id: 'cli-1', data: { namespace: 'ns' }, emit: mock(() => {}) }
    const cliNamespace = {
        sockets: new Map([['cli-1', cliSocket]]),
        adapter: { rooms: new Map([['session:s1', new Set(['cli-1'])]]) },
    }
    return {
        io: { of: mock(() => cliNamespace) },
        getSession: mock(() => ({ active: true, namespace: 'ns' })),
        terminalRegistry: new TerminalRegistry({ idleTimeoutMs: 0 }),
        maxTerminalsPerSocket: 3,
        maxTerminalsPerSession: 3,
        _cliSocket: cliSocket as unknown as { emit: ReturnType<typeof mock> },
    }
}

const PAYLOAD = { sessionId: 's1', terminalId: 't1', cols: 80, rows: 24 }

describe('terminal:create 同 socket 重连', () => {
    test('首次 create：转发 terminal:open 给 CLI，不报错', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)
        expect(deps._cliSocket.emit).toHaveBeenCalledWith(
            'terminal:open',
            expect.objectContaining({ terminalId: 't1' }),
        )
        expect(web.emit).not.toHaveBeenCalled()
    })

    test('同一 web socket 重连（重发 create）：成功，不报 already in use', () => {
        const web = makeSocket('web-1')
        const deps = makeDeps()
        registerTerminalHandlers(web as never, deps as never)
        web._handlers.get('terminal:create')!(PAYLOAD)
        deps._cliSocket.emit.mockClear()
        web.emit.mockClear()

        // 同 socket 重连：重发 create（前端 reconnect 场景）
        web._handlers.get('terminal:create')!(PAYLOAD)
        // CLI 再次收到 open（CLI 端 TerminalManager 复用已存在的 PTY）
        expect(deps._cliSocket.emit).toHaveBeenCalledWith(
            'terminal:open',
            expect.objectContaining({ terminalId: 't1' }),
        )
        // 不报 already in use
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

    test('达 session 上限（3）时同 socket 重连：先清旧 entry 再过上限检查，成功', () => {
        const deps = makeDeps()
        // 3 个 web socket 各开一个 terminal（每实例独占 socket），countForSession 达 3
        const mk = (id: string, tid: string) => {
            const web = makeSocket(id)
            registerTerminalHandlers(web as never, deps as never)
            web._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: tid, cols: 80, rows: 24 })
            return web
        }
        const web1 = mk('web-1', 't1')
        mk('web-2', 't2')
        mk('web-3', 't3')

        ;(deps._cliSocket.emit as ReturnType<typeof mock>).mockClear()
        web1.emit.mockClear()
        // web1 重连 t1（同 socket 重发 create）：旧 entry 先清，不触发 too many
        web1._handlers.get('terminal:create')!({ sessionId: 's1', terminalId: 't1', cols: 80, rows: 24 })
        expect(deps._cliSocket.emit).toHaveBeenCalledWith(
            'terminal:open',
            expect.objectContaining({ terminalId: 't1' }),
        )
        expect(web1.emit).not.toHaveBeenCalled()
    })
})
