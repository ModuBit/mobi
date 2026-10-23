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

// forked skill tap 订阅者单测（spec Testing Decisions：注入假 bridge）：
// 断言拼行形状、skill 校验、uuid 去重、截断标记、坏载荷静默跳过，以及
// 「实时行 uuid 进入会话级集合 → 流侧抑制」这条跨模块契约。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    registerForkedSkillTapSubscriber,
    type ForkedSkillTapSubscriberOptions,
} from '../../src/claude/bridge/forkedSkillTapSubscriber';
import {
    resetForkedSkillTapState,
    shouldSuppressSessionStreamMessage,
} from '../../src/claude/bridge/forkedSkillTapState';
import type { BridgeListener, BridgeSubscriber } from '../../src/claude/bridge/bridgeListener';
import type { RawJSONLines } from '../../src/claude/types';

function fakeBridge() {
    const subscribers = new Map<string, BridgeSubscriber>();
    const bridge = {
        socketPath: '/tmp/fake.sock',
        subscribe: (type: string, fn: BridgeSubscriber) => subscribers.set(type, fn),
        stop: async () => {},
    } as unknown as BridgeListener;
    const emit = (payload: unknown) => {
        for (const fn of subscribers.values()) fn(payload, 'mobi-forked-tap');
    };
    return { bridge, emit };
}

const THINKING_MESSAGE = { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: '……' }] };

function payload(overrides: Record<string, unknown> = {}) {
    return { skill: 'code-review', uuid: 'u-1', door: 'response', message: THINKING_MESSAGE, ...overrides };
}

function setup(overrides: Partial<ForkedSkillTapSubscriberOptions> = {}) {
    const { bridge, emit } = fakeBridge();
    const sendMessage = vi.fn();
    const stop = registerForkedSkillTapSubscriber(bridge, {
        resolveSessionId: () => 'sess-1',
        sendMessage,
        ...overrides,
    });
    return { emit, sendMessage, stop };
}

beforeEach(() => {
    resetForkedSkillTapState();
});

describe('forkedSkillTapSubscriber（bridge payload → 主对话行）', () => {
    it('拼成主对话行：补 sessionId/timestamp/isSidechain，不带 sidechain 标记', () => {
        const { emit, sendMessage } = setup();
        emit(payload());

        expect(sendMessage).toHaveBeenCalledTimes(1);
        const row = sendMessage.mock.calls[0][0] as RawJSONLines & Record<string, unknown>;
        expect(row.type).toBe('assistant');
        expect(row.uuid).toBe('u-1');
        expect(row.message).toEqual(THINKING_MESSAGE);
        expect(row.sessionId).toBe('sess-1');
        expect(row.isSidechain).toBe(false);
        expect(typeof row.timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(row.timestamp as string))).toBe(false);
        // 刻意不带：否则行会被归入 agent / sidechain 视图
        expect(row.parent_tool_use_id).toBeUndefined();
        expect(row.agentId).toBeUndefined();
        expect(row.isMeta).toBeUndefined();
    });

    it('tool_result 行（user）同样透传', () => {
        const { emit, sendMessage } = setup();
        emit(payload({
            uuid: 'u-2',
            door: 'tool-result',
            message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-1', content: 'ok' }] },
        }));
        expect((sendMessage.mock.calls[0][0] as RawJSONLines).type).toBe('user');
    });

    it('skill 不是 code-review / uuid 为空 / door 非法：静默跳过', () => {
        const { emit, sendMessage } = setup();
        emit(payload({ skill: 'frontend-design' }));
        emit(payload({ uuid: '' }));
        emit(payload({ door: 'attachment' }));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('坏载荷不影响后续合法行（通道粘性）', () => {
        const { emit, sendMessage } = setup();
        emit({ nonsense: true });
        emit(payload());
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('行形状不过 schema（如 message.type 非法）：静默跳过', () => {
        const { emit, sendMessage } = setup();
        emit(payload({ message: { type: 'attachment', content: [] } }));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('uuid 去重：同一实时行只转发一次', () => {
        const { emit, sendMessage } = setup();
        emit(payload());
        emit(payload());
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('截断标记：truncated 行照常转发（内容已在 mod 侧限长）', () => {
        const { emit, sendMessage } = setup();
        emit(payload({ truncated: true }));
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('sessionId 未就绪：丢弃该行', () => {
        const { emit, sendMessage } = setup({ resolveSessionId: () => null });
        emit(payload());
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('停用后不再转发', () => {
        const { emit, sendMessage, stop } = setup();
        stop();
        emit(payload());
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('实时行 → 流侧抑制（跨模块契约）', () => {
    it('已消费 uuid 的流消息被抑制；未消费的不受影响', () => {
        const { emit } = setup();
        emit(payload({ uuid: 'live-1' }));

        expect(shouldSuppressSessionStreamMessage({ uuid: 'live-1', message: THINKING_MESSAGE })).toBe(true);
        expect(shouldSuppressSessionStreamMessage({ uuid: 'stream-only', message: THINKING_MESSAGE })).toBe(false);
    });

    it('被丢弃的坏行不进入去重集合（否则会误伤流消息）', () => {
        const { emit } = setup({ resolveSessionId: () => null });
        emit(payload({ uuid: 'not-forwarded' }));
        expect(shouldSuppressSessionStreamMessage({ uuid: 'not-forwarded', message: THINKING_MESSAGE })).toBe(false);
    });

    it('出口同步抛出：不标记已消费（流侧仍可兜底该行）', () => {
        const { emit } = setup({
            sendMessage: () => {
                throw new Error('channel closed');
            },
        });
        emit(payload({ uuid: 'send-failed' }));
        expect(shouldSuppressSessionStreamMessage({ uuid: 'send-failed', message: THINKING_MESSAGE })).toBe(false);
    });
});
