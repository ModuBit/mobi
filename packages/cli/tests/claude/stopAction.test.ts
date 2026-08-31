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

import { describe, it, expect } from 'vitest'

import {
    resolveStopAction,
    resolvePostInterruptAction,
    applyPushToTurnTracking,
    isInterruptedTerminalReason,
    normalizeStopKind,
    stopBackgroundTasksAllSettled,
} from '../../src/claude/utils/stopAction'

/**
 * stopKind='turn' 的撤回三分支（spec §3.3）：初判只定意向；
 * 复验在 interrupt 返回后由 handleAbortRequest 做（两段式）。
 */

describe('resolveStopAction（stopKind=turn 时的撤回三分支）', () => {
    it('有输出 → stop', () => {
        expect(resolveStopAction({ turnHasOutput: true, pumpQueueEmpty: true, hasLastPushed: true })).toBe('stop')
    })
    it('pump 队列非空 → stop（队列下一条照跑）', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: false, hasLastPushed: true })).toBe('stop')
    })
    it('无输出 + 队列空 + 有 lastPushed → withdraw', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: true, hasLastPushed: true })).toBe('withdraw')
    })
    it('无 lastPushed（丢失/无 push 记录）→ 安全降级 stop', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: true, hasLastPushed: false })).toBe('stop')
    })
})

describe('applyPushToTurnTracking（push 绑定时的 turn 追踪更新，C1）', () => {
    it('turn push：复位 hasOutput（新 turn 起点）+ 覆盖撤回锚', () => {
        const next = applyPushToTurnTracking({ hasOutput: true, lastPushedNativeId: 'old' }, 'new', 'turn')
        expect(next).toEqual({ hasOutput: false, lastPushedNativeId: 'new' })
    })

    it('steer push：不复位 hasOutput（turn 运行中插入，产出不该被抹掉）但覆盖撤回锚', () => {
        // 反例场景（C1）：turn A 已产出工具调用（hasOutput=true），用户 steer 消息 B，
        // 若 steer 复位 hasOutput，工具执行期停止会误判 withdraw → 误删 B 及其后全部行
        const next = applyPushToTurnTracking({ hasOutput: true, lastPushedNativeId: 'A' }, 'B', 'steer')
        expect(next.hasOutput).toBe(true)
        expect(next.lastPushedNativeId).toBe('B')
    })

    it('steer push 在无输出时同样只更新锚（不凭空置位）', () => {
        const next = applyPushToTurnTracking({ hasOutput: false, lastPushedNativeId: 'A' }, 'B', 'steer')
        expect(next).toEqual({ hasOutput: false, lastPushedNativeId: 'B' })
    })

    it('空 bindings（nativeId null）不改状态', () => {
        const prev = { hasOutput: true, lastPushedNativeId: 'A' }
        expect(applyPushToTurnTracking(prev, null, 'turn')).toBe(prev)
    })
})

describe('resolvePostInterruptAction（interrupt 返回后的复验裁决，C1 修法 2 / I1）', () => {
    it('still_queued 非空 → stop（守卫降级：撤回目标仍会执行，软删会制造僵尸执行）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 1 })).toBe('stop')
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 3 })).toBe('stop')
    })

    it('无输出且 still_queued 空 → withdraw（两段式复验通过）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 0 })).toBe('withdraw')
    })

    it('等待期冒出输出 → stop（原有降级语义保留）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: true, stillQueuedCount: 0 })).toBe('stop')
    })

    it('守卫优先于输出判据（两者同真时仍 stop，语义一致）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: true, stillQueuedCount: 2 })).toBe('stop')
    })

    it('锚未变化（anchorChanged 省略/false）→ 不影响裁决（既有语义不变）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 0, anchorChanged: false })).toBe('withdraw')
    })

    it('撤回锚在 await interrupt() 窗口内被新 push 覆盖 → stop（queue-drain 竞态降级）', () => {
        // 初判后等待 interrupt 返回期间，新消息被消费成新 turn：lastPushedNativeId 覆盖为新锚、
        // hasOutput 复位——两个守卫全过，若不查锚变化会撤回一条已在执行的新消息
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 0, anchorChanged: true })).toBe('stop')
    })

    it('锚变化优先于其余判据（即使复验全过仍降级）', () => {
        expect(resolvePostInterruptAction({ turnHasOutput: false, stillQueuedCount: 0, anchorChanged: true })).toBe('stop')
    })
})

describe('isInterruptedTerminalReason（中断终态判别，web normalizeAgent 同口径）', () => {
    it('aborted_streaming / aborted_tools → true', () => {
        expect(isInterruptedTerminalReason('aborted_streaming')).toBe(true)
        expect(isInterruptedTerminalReason('aborted_tools')).toBe(true)
    })
    it('正常/compact/completed/缺失 → false', () => {
        expect(isInterruptedTerminalReason('completed')).toBe(false)
        expect(isInterruptedTerminalReason(undefined)).toBe(false)
        expect(isInterruptedTerminalReason(null)).toBe(false)
    })
})

describe('stopBackgroundTasksAllSettled（后台任务并行停止）', () => {
    it('全部成功 → 无失败记录，每个任务各调一次 stopTask', async () => {
        const stopped: string[] = []
        const failures = await stopBackgroundTasksAllSettled(['a', 'b'], async (id) => { stopped.push(id) })
        expect(stopped.sort()).toEqual(['a', 'b'])
        expect(failures).toEqual([])
    })
    it('单个 rejection 不中断其余任务，失败按 { taskId, error } 返回（保失败日志）', async () => {
        const stopped: string[] = []
        const boom = new Error('boom')
        const failures = await stopBackgroundTasksAllSettled(
            ['a', 'b', 'c'],
            async (id) => {
                if (id === 'b') throw boom
                stopped.push(id)
            },
        )
        expect(stopped.sort()).toEqual(['a', 'c'])
        expect(failures).toEqual([{ taskId: 'b', error: boom }])
    })
    it('空集合 → 直接返回，不调 stopTask', async () => {
        let calls = 0
        const failures = await stopBackgroundTasksAllSettled([], async () => { calls++ })
        expect(calls).toBe(0)
        expect(failures).toEqual([])
    })
})

describe('normalizeStopKind（abort 入口校验：未知值回落默认档）', () => {
    it('三档合法值原样透传', () => {
        expect(normalizeStopKind('turn')).toBe('turn')
        expect(normalizeStopKind('turn-queue')).toBe('turn-queue')
        expect(normalizeStopKind('turn-queue-tasks')).toBe('turn-queue-tasks')
    })
    it('未知字符串（手误 / 未来第 4 档）→ 回落 turn（不得静默升级为清队列）', () => {
        // isCancelQueued 是负向默认（kind !== 'turn' 即清队列），未知值透传会静默升级为破坏性行为
        expect(normalizeStopKind('turn-queues')).toBe('turn')
        expect(normalizeStopKind('stop-all')).toBe('turn')
        expect(normalizeStopKind('')).toBe('turn')
    })
    it('非字符串（null / undefined / 数字）→ 回落 turn', () => {
        expect(normalizeStopKind(null)).toBe('turn')
        expect(normalizeStopKind(undefined)).toBe('turn')
        expect(normalizeStopKind(42)).toBe('turn')
    })
})

describe('shouldSkipWithdrawnResultForward（撤回后中断 result 的转发抑制）', () => {
    it('已内联至 claudeRemoteLauncher 调用点：外层 isInterruptedTerminalReason 收窄后退化为标志直查，'
        + '等价行为由 isInterruptedTerminalReason 判别用例 + 调用点类型收窄保证', () => {
        // 内联前形态 shouldSkipWithdrawnResultForward(suppress, reason) === suppress && isInterrupted(reason)；
        // 调用点位于 isInterruptedTerminalReason(reason)===true 分支内，恒等价于 suppress 直查
        expect(isInterruptedTerminalReason('aborted_streaming')).toBe(true)
        expect(isInterruptedTerminalReason('completed')).toBe(false)
    })
})
