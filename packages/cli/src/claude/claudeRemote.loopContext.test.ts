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

import { describe, expect, it, vi } from 'vitest'
import { sdkOutputLoop, type LoopContext } from './claudeRemote'
import { StreamSnapshotSender } from './utils/streamSnapshotSender'

/** 最小可用 snapshotSender 桩：sdkOutputLoop 只调这些方法 */
function stubSnapshotSender(): StreamSnapshotSender {
    return {
        clearBuffers: vi.fn(),
        setSnapshotOpts: vi.fn(),
        startBlock: vi.fn(),
        append: vi.fn(),
        endBlock: vi.fn(),
        flush: vi.fn(),
        injectThinkingMeta: vi.fn(),
        markFullDelivered: vi.fn(),
        consumePendingFull: vi.fn(() => null),
        destroy: vi.fn(),
        start: vi.fn(),
    } as unknown as StreamSnapshotSender
}

/** 用最小 SDK 消息序列驱动 sdkOutputLoop（assembler 透传 init/result，无 assistant 无需完整 message 体） */
async function drive(ctx: LoopContext): Promise<{ runningChanges: boolean[] }> {
    const runningChanges: boolean[] = []
    const onRunningChange = (r: boolean) => runningChanges.push(r)
    // init 不带 session_id：带 session_id 会触发 awaitFileExist 的 10s 会话文件轮询，
    // 与本测试无关（门控行为只关乎 onRunningChange 时序）
    const response = (async function* () {
        yield { type: 'system', subtype: 'init' } as never
        yield { type: 'result', subtype: 'success' } as never
    })()
    await sdkOutputLoop(response as never, ctx, {
        path: '/tmp',
        onMessage: vi.fn(),
        snapshotSender: stubSnapshotSender(),
        onSessionFound: vi.fn(),
        onReady: vi.fn(),
        onRunningChange,
    })
    return { runningChanges }
}

describe('sdkOutputLoop init→running 门控（提前激活）', () => {
    it('hasInput=false（提前激活窗口）→ init 不置 running，result 复位不误报', async () => {
        const { runningChanges } = await drive({ isCompactCommand: false, compactStarted: false, hasInput: false })
        expect(runningChanges).toEqual([false])
    })

    it('hasInput=true（真实输入后）→ init 置 running，result 复位', async () => {
        const { runningChanges } = await drive({ isCompactCommand: false, compactStarted: false, hasInput: true })
        expect(runningChanges).toEqual([true, false])
    })
})
