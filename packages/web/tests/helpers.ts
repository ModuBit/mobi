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
 * 共享 mock 数据工厂
 * 为各测试文件提供统一的测试数据构造工具
 */

import type { NormalizedMessage, ToolCallBlock, ChatToolCall } from '@/domain/chat/types'
import type { DecryptedMessage } from '@mobi/shared'

/**
 * 创建 mock NormalizedMessage（用户文本消息为默认）
 */
export function createMockNormalizedMessage(
    overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
    return {
        id: 'msg-1',
        localId: null,
        createdAt: 1000,
        role: 'user',
        content: { type: 'text', text: '测试消息' },
        isSidechain: false,
        ...overrides,
    } as NormalizedMessage
}

/**
 * 创建 mock 用户文本 NormalizedMessage
 */
export function createMockUserMessage(
    overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
    return createMockNormalizedMessage({
        role: 'user',
        content: { type: 'text', text: '用户消息' },
        isSidechain: false,
        ...overrides,
    }) as NormalizedMessage & { role: 'user' }
}

/**
 * 创建 mock Agent NormalizedMessage（含 tool-call）
 */
export function createMockAgentMessage(
    overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
    return createMockNormalizedMessage({
        id: 'msg-agent-1',
        role: 'agent',
        content: [
            { type: 'text', text: '助手回复', uuid: 'uuid-1', parentUUID: null },
        ],
        isSidechain: false,
        ...overrides,
    }) as NormalizedMessage & { role: 'agent' }
}

/**
 * 创建 mock DecryptedMessage
 */
export function createMockDecryptedMessage(
    overrides: Partial<DecryptedMessage> = {}
): DecryptedMessage {
    return {
        id: 'msg-1',
        seq: 1,
        localId: null,
        createdAt: 1000,
        content: {
            role: 'user',
            content: '测试消息',
        },
        ...overrides,
    }
}

/**
 * 创建 mock ChatToolCall
 */
export function createMockChatToolCall(
    id: string = 'tool-1',
    overrides: Partial<ChatToolCall> = {}
): ChatToolCall {
    return {
        id,
        name: 'Read',
        state: 'running',
        input: { file_path: '/test/file.ts' },
        createdAt: 1000,
        startedAt: 1000,
        completedAt: null,
        description: null,
        ...overrides,
    }
}

/**
 * 创建 mock ToolCallBlock
 */
export function createMockToolCallBlock(
    id: string = 'tool-1',
    overrides: Partial<ToolCallBlock> = {}
): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1000,
        tool: createMockChatToolCall(id),
        children: [],
        ...overrides,
    }
}
