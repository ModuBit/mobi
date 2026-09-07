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
 * #62 缺陷二回归：后台 Agent drawer 实时性——sidechain 消息经 SSE 增量入窗后，
 * Agent tool block 的 children 应随归约增长（而非冻结在初始快照）。
 * 全保真链路：messageWindowStore.ingest（SSE 入库语义）→ normalizeDecryptedMessage →
 * reduceChatBlocks（tracer 分组）→ Agent tool-call block.children。
 */

import { describe, expect, it, beforeEach } from 'vitest'

import {
    normalizeDecryptedMessage,
    reduceChatBlocks,
    type ChatBlock,
} from '@/domain/chat'
import {
    ingestIncomingMessages,
    getMessageWindowState,
    _resetForTest,
} from '@/core/data/stores/messageWindowStore'
import type { DecryptedMessage } from '@/core/data/api/types'

const SID = 'sidechain-live-test'

/** 主链 Task tool_use（初始拉取就在窗口，API list 只含主链） */
function taskMessage(): DecryptedMessage {
    return {
        id: 'm-task',
        seq: 1,
        snapshot: false,
        createdAt: 1000,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid: 'u-main-1',
                    parentUuid: null,
                    isSidechain: false,
                    message: {
                        content: [{
                            type: 'tool_use',
                            id: 'tool-task-1',
                            name: 'Task',
                            input: { prompt: '子任务提示词', description: '派发' },
                        }],
                    },
                },
            },
        },
    } as unknown as DecryptedMessage
}

/** sidechain root：user 信封 isSidechain=true，message.content 为 string prompt */
function sidechainRoot(): DecryptedMessage {
    return {
        id: 'm-sc-root',
        seq: 2,
        snapshot: false,
        createdAt: 2000,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 's-root',
                    parentUuid: 'u-main-1',
                    isSidechain: true,
                    message: { content: '子任务提示词' },
                },
            },
        },
    } as unknown as DecryptedMessage
}

/** sidechain assistant：isSidechain=true，parentUUID 链到 root */
function sidechainAssistant(id: string, uuid: string, parentUuid: string, text: string): DecryptedMessage {
    return {
        id,
        seq: 0,
        snapshot: false,
        createdAt: 3000,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid,
                    parentUuid,
                    isSidechain: true,
                    message: { content: [{ type: 'text', text }] },
                },
            },
        },
    } as unknown as DecryptedMessage
}

/** sidechain 中段的 MCP 截图反馈：data.type=user、message.content=[text]（生产缺陷形态） */
function screenshotFeedback(): DecryptedMessage {
    return {
        id: 'm-sc-img',
        seq: 0,
        snapshot: false,
        createdAt: 3500,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 's-img',
                    parentUuid: 's-1',
                    isSidechain: true,
                    message: {
                        content: [{ type: 'text', text: '[Image: original 2210x950, displayed at 2000x860. Multiply coordinates by 1.10 to map to original image.]' }],
                    },
                },
            },
        },
    } as unknown as DecryptedMessage
}

function agentChildrenOfTask(messages: DecryptedMessage[]): number {
    const normalized = messages
        .map(m => normalizeDecryptedMessage(m))
        .filter(m => m !== null)
    const { blocks } = reduceChatBlocks(normalized, null)
    const findTask = (list: ChatBlock[]): ChatBlock | null => {
        for (const b of list) {
            if (b.kind === 'tool-call' && b.tool.name === 'Task') return b
            if (b.kind === 'tool-call' && b.children.length > 0) {
                const nested = findTask(b.children)
                if (nested) return nested
            }
        }
        return null
    }
    const task = findTask(blocks)
    return task && task.kind === 'tool-call' ? task.children.length : -1
}

describe('#62 缺陷二：sidechain SSE 增量 → Agent drawer children 实时增长', () => {
    beforeEach(() => {
        _resetForTest()
    })

    it('基线：主链 + 全部 sidechain 一次性归约 → children 分组成立', () => {
        const messages = [
            taskMessage(),
            sidechainRoot(),
            sidechainAssistant('m-sc-1', 's-1', 's-root', '子代理输出一'),
        ]
        expect(agentChildrenOfTask(messages)).toBe(2)
    })

    it('实时增量：Task 先在窗口，sidechain 逐条 SSE 到达 → children 逐步增长', () => {
        ingestIncomingMessages(SID, [taskMessage()])
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(0)

        ingestIncomingMessages(SID, [sidechainRoot()])
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(1)

        ingestIncomingMessages(SID, [sidechainAssistant('m-sc-1', 's-1', 's-root', '子代理输出一')])
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(2)
    })

    it('乱序：child 先于 root 到达（orphan 暂挂），root 补到后归组', () => {
        ingestIncomingMessages(SID, [taskMessage()])
        ingestIncomingMessages(SID, [sidechainAssistant('m-sc-1', 's-1', 's-root', '子代理输出一')])
        // root 未到：child 是 orphan，不进 children（但也绝不能进主时间线渲染）
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(0)

        ingestIncomingMessages(SID, [sidechainRoot()])
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(2)
    })

    it('snapshot 流式：sidechain snapshot 先到，full 覆盖后不重复计数', () => {
        ingestIncomingMessages(SID, [taskMessage()])
        const snap = { ...sidechainAssistant('m-sc-1', 's-1', 's-root', '子'), snapshot: true } as DecryptedMessage
        ingestIncomingMessages(SID, [snap])
        ingestIncomingMessages(SID, [sidechainAssistant('m-sc-1', 's-1', 's-root', '子代理输出一')])
        ingestIncomingMessages(SID, [sidechainRoot()])
        expect(agentChildrenOfTask(getMessageWindowState(SID).messages)).toBe(2)
    })

    it('MCP 截图反馈（sidechain 中段数组 user 消息）挂进 children，不泄漏主线', () => {
        // 生产缺陷（2026-09-07）：chrome-devtools 截图反馈以 data.type=user、message.content=[text]
        // 进入 sidechain 中段。handleUserOutput 的 sidechain 数组分支转 sidechain prompt 形态时
        // 丢失 parentUUID → tracer 既匹配不上 Task prompt、又取不到 parentUuid → 兜底放行主线，
        // 以 user-text 气泡渲染成「没人发的用户消息」（刷新后主线 fetch 排除 sidechain 而消失）。
        ingestIncomingMessages(SID, [taskMessage()])
        ingestIncomingMessages(SID, [sidechainRoot()])
        ingestIncomingMessages(SID, [sidechainAssistant('m-sc-1', 's-1', 's-root', '子代理输出一')])
        ingestIncomingMessages(SID, [screenshotFeedback()])

        const messages = getMessageWindowState(SID).messages
        // 挂进 Task children（root + assistant + 截图反馈）
        expect(agentChildrenOfTask(messages)).toBe(3)
        // 主线时间线（顶层 blocks）不得出现泄漏块；Task children 里的 user-text 是
        // subagent 面板的合法渲染（sidechain prompt 本就显示为用户气泡），不算泄漏
        const { blocks } = reduceChatBlocks(
            messages.map(m => normalizeDecryptedMessage(m)).filter(m => m !== null),
            null,
        )
        expect(blocks.some(b => b.kind === 'user-text' && b.blocks.some(x => x.type === 'text' && x.text.includes('[Image')))).toBe(false)
    })
})
