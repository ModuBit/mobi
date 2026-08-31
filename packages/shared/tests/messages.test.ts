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
    isRoleWrappedRecord,
    unwrapRoleWrappedRecordEnvelope,
    isClaudeChatVisibleSystemSubtype,
    isClaudeChatVisibleMessage,
    isLifecycleAhead,
    isCancelQueued,
    shouldStopTasks,
    DEFAULT_STOP_KIND,
    STOP_KIND_VALUES,
    LIFECYCLE_RANK,
    type MessageFact,
} from '../src/messages'

describe('isRoleWrappedRecord', () => {
    it('含 role 和 content 的对象返回 true', () => {
        expect(isRoleWrappedRecord({ role: 'user', content: 'hello' })).toBe(true)
        expect(isRoleWrappedRecord({ role: 'assistant', content: { text: 'hi' } })).toBe(true)
        // 含额外字段也应返回 true
        expect(isRoleWrappedRecord({ role: 'user', content: 'hi', meta: {} })).toBe(true)
    })

    it('缺少 role 返回 false', () => {
        expect(isRoleWrappedRecord({ content: 'hello' })).toBe(false)
    })

    it('缺少 content 返回 false', () => {
        expect(isRoleWrappedRecord({ role: 'user' })).toBe(false)
    })

    it('非对象返回 false', () => {
        expect(isRoleWrappedRecord(null)).toBe(false)
        expect(isRoleWrappedRecord(undefined)).toBe(false)
        expect(isRoleWrappedRecord('string')).toBe(false)
        expect(isRoleWrappedRecord(42)).toBe(false)
    })
})

describe('unwrapRoleWrappedRecordEnvelope', () => {
    const validRecord = { role: 'user', content: 'hello' }

    it('直接 record 直接解包', () => {
        const result = unwrapRoleWrappedRecordEnvelope(validRecord)
        expect(result).toEqual(validRecord)
    })

    it('message 字段解包', () => {
        const wrapper = { message: validRecord }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('data.message 解包', () => {
        const wrapper = { data: { message: validRecord } }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('payload.message 解包', () => {
        const wrapper = { payload: { message: validRecord } }
        const result = unwrapRoleWrappedRecordEnvelope(wrapper)
        expect(result).toEqual(validRecord)
    })

    it('无法解包返回 null', () => {
        expect(unwrapRoleWrappedRecordEnvelope(null)).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope(undefined)).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope({})).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope({ foo: 'bar' })).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope('string')).toBeNull()
        expect(unwrapRoleWrappedRecordEnvelope(42)).toBeNull()
    })
})

describe('isClaudeChatVisibleSystemSubtype', () => {
    it('api_error 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('api_error')).toBe(true)
    })

    it('api_retry 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('api_retry')).toBe(true)
    })

    it('compact_boundary 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('compact_boundary')).toBe(true)
    })

    it('turn_duration 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('turn_duration')).toBe(true)
    })

    it('microcompact_boundary 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('microcompact_boundary')).toBe(true)
    })

    it('task_started 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('task_started')).toBe(true)
    })

    it('task_updated 返回 true', () => {
        expect(isClaudeChatVisibleSystemSubtype('task_updated')).toBe(true)
    })

    it('init 返回 false', () => {
        expect(isClaudeChatVisibleSystemSubtype('init')).toBe(false)
    })

    it('非字符串返回 false', () => {
        expect(isClaudeChatVisibleSystemSubtype(123)).toBe(false)
        expect(isClaudeChatVisibleSystemSubtype(null)).toBe(false)
        expect(isClaudeChatVisibleSystemSubtype(undefined)).toBe(false)
    })
})

describe('isClaudeChatVisibleMessage', () => {
    it('非 system 且非 ephemeral 顶层类型返回 true', () => {
        expect(isClaudeChatVisibleMessage({ type: 'user' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'assistant' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'tool_result' })).toBe(true)
    })

    it('tool_progress / tool_use_summary 已接入 handler，视为可见', () => {
        // 这两类 ephemeral 消息由 web normalize 产出 tool-progress / tool-use-summary 事件，
        // 挂到对应工具卡片（耗时显示 / 摘要），不再被 JSON dump 当文本渲染
        expect(isClaudeChatVisibleMessage({ type: 'tool_progress' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'tool_use_summary' })).toBe(true)
    })

    it('system + 可见子类型返回 true', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'api_error' })).toBe(true)
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'compact_boundary' })).toBe(true)
    })

    it('system + 不可见子类型返回 false', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'init' })).toBe(false)
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'other' })).toBe(false)
    })

    it('system 无 subtype 返回 false', () => {
        expect(isClaudeChatVisibleMessage({ type: 'system' })).toBe(false)
    })

    it('command_lifecycle 返回 false（控制帧，历史落库行静默跳过）', () => {
        // SDK 0.3.206 新增的排队生命周期回执，早期版本曾被当 persistent 落库；
        // 现由 classifyMessage discard 拦截新消息，此处兜底过滤历史行（web 端不再 console.warn）
        expect(isClaudeChatVisibleMessage({ type: 'command_lifecycle' })).toBe(false)
    })
})

// ========== unwrapOutputMessage（SDK 输出消息解包骨架收口）==========

import { unwrapOutputMessage } from '../src/messages'

describe('unwrapOutputMessage', () => {
    /** 构造完整 output 信封：envelope → output → data → message.content */
    function makeEnvelope(role: string, dataType: string, blocks: unknown[], extraData: Record<string, unknown> = {}) {
        return {
            role,
            content: {
                type: 'output',
                data: { type: dataType, message: { content: blocks }, ...extraData },
            },
        }
    }

    it('完整结构解包出 role/data/message/blocks', () => {
        const blocks = [{ type: 'tool_use', id: 't1', name: 'Agent', input: {} }]
        const result = unwrapOutputMessage(makeEnvelope('agent', 'assistant', blocks))
        expect(result).not.toBeNull()
        expect(result!.role).toBe('agent')
        expect(result!.data.type).toBe('assistant')
        expect(result!.blocks).toEqual(blocks)
    })

    it('system 消息（无 message 字段）仍解包出 role/data，message/blocks 为 null', () => {
        const systemMessage = {
            role: 'agent',
            content: { type: 'output', data: { type: 'system', subtype: 'task_started', task_id: 't1' } },
        }
        const result = unwrapOutputMessage(systemMessage)
        expect(result).not.toBeNull()
        expect(result!.data.subtype).toBe('task_started')
        expect(result!.message).toBeNull()
        expect(result!.blocks).toBeNull()
    })

    it('保留 data 层的同级字段（tool_use_result 等）', () => {
        const result = unwrapOutputMessage(
            makeEnvelope('user', 'user', [], { tool_use_result: { task: { id: 'x' } } })
        )
        expect(result!.data.tool_use_result).toEqual({ task: { id: 'x' } })
    })

    it('不过滤 role：agent / user 均可解包（真实消息类型看 data.type）', () => {
        expect(unwrapOutputMessage(makeEnvelope('agent', 'assistant', []))).not.toBeNull()
        expect(unwrapOutputMessage(makeEnvelope('user', 'user', []))).not.toBeNull()
    })

    it('非 output 信封返回 null', () => {
        expect(unwrapOutputMessage({ role: 'agent', content: { type: 'stream_event' } })).toBeNull()
        expect(unwrapOutputMessage({ role: 'agent', content: 'text' })).toBeNull()
    })

    it('message.content 非数组时仍解包，blocks 为 null', () => {
        const stringContent = unwrapOutputMessage(makeEnvelope('agent', 'assistant', 'oops' as never))
        expect(stringContent).not.toBeNull()
        expect(stringContent!.blocks).toBeNull()

        const noContent = unwrapOutputMessage({
            role: 'agent',
            content: { type: 'output', data: { type: 'assistant', message: {} } },
        })
        expect(noContent).not.toBeNull()
        expect(noContent!.blocks).toBeNull()
    })

    it('嵌套信封（message / data.message / payload.message 包装）同样解包', () => {
        const inner = makeEnvelope('agent', 'system', [])
        expect(unwrapOutputMessage({ message: inner })).not.toBeNull()
        expect(unwrapOutputMessage({ data: { message: inner } })).not.toBeNull()
        expect(unwrapOutputMessage({ payload: { message: inner } })).not.toBeNull()
    })

    it('非对象输入返回 null', () => {
        expect(unwrapOutputMessage(null)).toBeNull()
        expect(unwrapOutputMessage(undefined)).toBeNull()
        expect(unwrapOutputMessage('string')).toBeNull()
    })
})

describe('isLifecycleAhead', () => {
    it('rank 前进返回 true（queued→pushed / processing→done）', () => {
        expect(isLifecycleAhead('queued', 'pushed')).toBe(true)
        expect(isLifecycleAhead('processing', 'done')).toBe(true)
        expect(isLifecycleAhead('queued', 'withdrawn')).toBe(true)
    })

    it('同 rank 终态互不覆盖（done→cancelled false）', () => {
        expect(isLifecycleAhead('done', 'cancelled')).toBe(false)
        expect(isLifecycleAhead('cancelled', 'done')).toBe(false)
        expect(isLifecycleAhead('done', 'discarded')).toBe(false)
    })

    it('回退返回 false（pushed→queued）', () => {
        expect(isLifecycleAhead('pushed', 'queued')).toBe(false)
        expect(isLifecycleAhead('done', 'processing')).toBe(false)
    })

    it('null / undefined 任一侧返回 false（非排队轨道不参与推进）', () => {
        expect(isLifecycleAhead(null, 'queued')).toBe(false)
        expect(isLifecycleAhead('queued', null)).toBe(false)
        expect(isLifecycleAhead(undefined, 'done')).toBe(false)
        expect(isLifecycleAhead('done', undefined)).toBe(false)
        expect(isLifecycleAhead(null, null)).toBe(false)
    })

    it('相同状态返回 false', () => {
        expect(isLifecycleAhead('queued', 'queued')).toBe(false)
        expect(isLifecycleAhead('done', 'done')).toBe(false)
    })

    it('withdrawn 高位：任何→withdrawn true、withdrawn→任何 false', () => {
        expect(isLifecycleAhead('queued', 'withdrawn')).toBe(true)
        expect(isLifecycleAhead('done', 'withdrawn')).toBe(true)
        expect(isLifecycleAhead('processing', 'withdrawn')).toBe(true)
        expect(isLifecycleAhead('withdrawn', 'queued')).toBe(false)
        expect(isLifecycleAhead('withdrawn', 'done')).toBe(false)
    })
})

describe('StopKind 判别函数', () => {
    it('缺省值为 turn', () => {
        expect(DEFAULT_STOP_KIND).toBe('turn')
    })
    it('STOP_KIND_VALUES 与 StopKind 三档一一对应（hub z.enum 单一来源，勿手写副本）', () => {
        expect([...STOP_KIND_VALUES]).toEqual(['turn', 'turn-queue', 'turn-queue-tasks'])
        // 判别函数对每个运行时取值都有定义（覆盖完备性）
        for (const kind of STOP_KIND_VALUES) {
            expect(typeof isCancelQueued(kind)).toBe('boolean')
            expect(typeof shouldStopTasks(kind)).toBe('boolean')
        }
        expect(DEFAULT_STOP_KIND).toBe(STOP_KIND_VALUES[0])
    })
    it('turn 档不清队列不停任务', () => {
        expect(isCancelQueued('turn')).toBe(false)
        expect(shouldStopTasks('turn')).toBe(false)
    })
    it('turn-queue 档清队列不停任务', () => {
        expect(isCancelQueued('turn-queue')).toBe(true)
        expect(shouldStopTasks('turn-queue')).toBe(false)
    })
    it('turn-queue-tasks 档清队列且停任务', () => {
        expect(isCancelQueued('turn-queue-tasks')).toBe(true)
        expect(shouldStopTasks('turn-queue-tasks')).toBe(true)
    })
})

describe('lifecycle refused 终态', () => {
    it('refused 与 done/cancelled/discarded 同 rank（互不覆盖）', () => {
        expect(LIFECYCLE_RANK.refused).toBe(4)
        expect(isLifecycleAhead('done', 'refused')).toBe(false)
        expect(isLifecycleAhead('refused', 'cancelled')).toBe(false)
    })
    it('withdrawn 仍为最高位，任何终态不覆盖它', () => {
        expect(isLifecycleAhead('withdrawn', 'refused')).toBe(false)
        expect(isLifecycleAhead('processing', 'withdrawn')).toBe(true)
    })
    it('lifecycle fact 接受 refused 状态与 terminalReason', () => {
        const f: MessageFact = { kind: 'lifecycle', nativeId: 'n1', state: 'refused', terminalReason: 'policy' }
        expect(f).toMatchObject({ state: 'refused', terminalReason: 'policy' })
    })
    it('withdrawn fact 形状', () => {
        const f: MessageFact = { kind: 'withdrawn', nativeId: 'n1', at: 1 }
        expect(f.kind).toBe('withdrawn')
    })
})
