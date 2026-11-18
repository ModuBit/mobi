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
 * remote 启动器骨架（tui-fork 票 05）：local 模式退场后，这里只剩
 * 主循环 + 清理 + abort RPC 的装配——不再注册 switch 处理器。
 */

import { describe, expect, it, vi } from 'vitest'
import { RemoteLauncherBase } from '@/modules/common/remote/RemoteLauncherBase'

type RegisteredHandler = (params?: unknown) => Promise<unknown> | unknown

function makeRpc() {
    const handlers = new Map<string, RegisteredHandler>()
    return {
        handlers,
        registerHandler: vi.fn((method: string, handler: RegisteredHandler) => {
            handlers.set(method, handler)
        }),
    }
}

class TestLauncher extends RemoteLauncherBase {
    loopCalls = 0
    cleanupCalls = 0

    constructor(private readonly throwInLoop = false) {
        super()
    }

    protected async runMainLoop(): Promise<void> {
        this.loopCalls += 1
        if (this.throwInLoop) throw new Error('boom')
    }

    protected async cleanup(): Promise<void> {
        this.cleanupCalls += 1
    }

    installAbort(rpc: ReturnType<typeof makeRpc>, onAbort: (stopKind: string) => void): void {
        this.setupAbortHandlers(rpc, { onAbort })
    }

    clear(rpc: ReturnType<typeof makeRpc>): void {
        this.clearAbortHandlers(rpc)
    }

    run(): Promise<void> {
        return this.start()
    }
}

describe('RemoteLauncherBase（remote 单路径）', () => {
    it('只注册 abort，不再注册 switch', () => {
        const rpc = makeRpc()
        const onAbort = vi.fn()
        new TestLauncher().installAbort(rpc, onAbort)

        expect(rpc.handlers.has('abort')).toBe(true)
        expect(rpc.handlers.has('switch')).toBe(false)
    })

    it('abort 的 stopKind 缺省或未知值回落 turn', async () => {
        const rpc = makeRpc()
        const onAbort = vi.fn()
        new TestLauncher().installAbort(rpc, onAbort)

        await rpc.handlers.get('abort')!({})
        await rpc.handlers.get('abort')!({ stopKind: 'unknown-kind' })
        await rpc.handlers.get('abort')!({ stopKind: 'turn-queue' })

        expect(onAbort.mock.calls).toEqual([['turn'], ['turn'], ['turn-queue']])
    })

    it('start 依次执行主循环与清理', async () => {
        const launcher = new TestLauncher()
        await launcher.run()
        expect(launcher.loopCalls).toBe(1)
        expect(launcher.cleanupCalls).toBe(1)
    })

    it('主循环抛错时仍执行清理并向上抛出', async () => {
        const launcher = new TestLauncher(true)
        await expect(launcher.run()).rejects.toThrow('boom')
        expect(launcher.cleanupCalls).toBe(1)
    })

    it('clearAbortHandlers 把 abort 换成空实现', async () => {
        const rpc = makeRpc()
        const onAbort = vi.fn()
        const launcher = new TestLauncher()
        launcher.installAbort(rpc, onAbort)
        launcher.clear(rpc)

        await rpc.handlers.get('abort')!({ stopKind: 'turn' })
        expect(onAbort).not.toHaveBeenCalled()
    })
})
