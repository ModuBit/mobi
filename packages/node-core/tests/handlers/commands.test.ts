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
 * registerCommandHandlers 的 idle 分类接线（pending #114）：
 * refreshMetadata 是 daemon→session RPC 全集里唯一的 ambient 成员（SWR 后台刷新，
 * fire-and-forget 周期性发生）——它进 idle reset 会持续清零空闲倒计时，会话永不
 * 休眠。其余 daemon→session RPC（permission/abort/rewind/config 族）都是用户显式
 * 动作，保持重置语义。本测试锁接线：refreshMetadata 注册必须带 skipIdleTimerReset。
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/claudeSdk/metadataExtractor', () => ({
    extractSDKMetadata: vi.fn(async () => ({ sdkVersion: 'test' })),
}))

const { RpcHandlerManager } = await import('../../src/rpc/RpcHandlerManager')
const { registerCommandHandlers } = await import('../../src/handlers/commands')

describe('registerCommandHandlers：ambient RPC 不重置 idle（pending #114）', () => {
    it('refreshMetadata 被调时 onRpcCalled 不触发（skipIdleTimerReset 接线）', async () => {
        const m = new RpcHandlerManager({ scopePrefix: 'sess-1' })
        const idleReset = vi.fn()
        m.setOnRpcCalled(idleReset)
        registerCommandHandlers(m, '/tmp/wd')
        const res = await m.handleRequest({ method: 'sess-1:refreshMetadata', params: {} })
        expect(res).toMatchObject({ success: true })
        expect(idleReset).not.toHaveBeenCalled()
    })
})
