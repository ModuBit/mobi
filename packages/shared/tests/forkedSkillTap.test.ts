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

// forked skill tap 契约单测：只断言外部行为（给一条流消息 → 是否抑制；给一个载荷 → 是否合法），
// 不测信封如何拼装、订阅者如何接线（那些在 session 订阅者测试里）。

import { describe, it, expect } from 'vitest';
import {
    CODE_REVIEW_FORK_PARENT_ID,
    FORKED_SKILL_TAP_ENVELOPE_TYPE,
    ForkedSkillAppendPayloadSchema,
    shouldSuppressStreamMessage,
} from '../src/forkedSkillTap';

const CODE_REVIEW = 'forked-command-code-review';
const OTHER_FORK = 'forked-command-frontend-design';

const textMessage = (text: string) => ({ content: [{ type: 'text', text }] });

describe('shouldSuppressStreamMessage', () => {
    it('uuid 已在实时行集合中 → 抑制（流末尾重放）', () => {
        expect(shouldSuppressStreamMessage({ uuid: 'u-1', message: textMessage('hi') }, new Set(['u-1']))).toBe(true);
    });

    it('uuid 未命中且非 fork 行 → 放行', () => {
        expect(shouldSuppressStreamMessage({ uuid: 'u-2', message: textMessage('hi') }, new Set(['u-1']))).toBe(false);
    });

    it('code-review fork 的纯 text 行 → 抑制（与主循环最终答复重复）', () => {
        const message = { uuid: 'u-3', parent_tool_use_id: CODE_REVIEW, message: textMessage('最终答复') };
        // 前提：本会话确实消费过实时行（否则见下一条用例）
        expect(shouldSuppressStreamMessage(message, new Set(['live-1']))).toBe(true);
    });

    it('实时链路未生效（集合为空）→ fork 文本放行，保留「结束后一次性出现」的退路', () => {
        // mods 未启用 / 插件加载失败 / hook worker 崩溃：实时行一条不产生，
        // 此时 fork 文本是唯一内容来源，不能被吞掉
        const message = { uuid: 'u-3b', parent_tool_use_id: CODE_REVIEW, message: textMessage('最终答复') };
        expect(shouldSuppressStreamMessage(message, new Set())).toBe(false);
    });

    it('code-review fork 的含非 text 行 → 放行（工具调用/思考需按正常路径处理）', () => {
        const withToolUse = {
            uuid: 'u-4',
            parent_tool_use_id: CODE_REVIEW,
            message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] },
        };
        expect(shouldSuppressStreamMessage(withToolUse, new Set())).toBe(false);
        const thinkingOnly = {
            uuid: 'u-5',
            parent_tool_use_id: CODE_REVIEW,
            message: { content: [{ type: 'thinking', thinking: '…' }] },
        };
        expect(shouldSuppressStreamMessage(thinkingOnly, new Set())).toBe(false);
    });

    it('code-review fork 的空 content → 放行（空消息不按 text 处理）', () => {
        expect(shouldSuppressStreamMessage({ uuid: 'u-6', parent_tool_use_id: CODE_REVIEW, message: { content: [] } }, new Set())).toBe(false);
    });

    it('其他 forked skill 与普通子代理的纯 text 行 → 放行（不受本特性影响）', () => {
        expect(shouldSuppressStreamMessage({ uuid: 'u-7', parent_tool_use_id: OTHER_FORK, message: textMessage('x') }, new Set())).toBe(false);
        expect(shouldSuppressStreamMessage({ uuid: 'u-8', parent_tool_use_id: 'toolu_abc', message: textMessage('x') }, new Set())).toBe(false);
    });

    it('主循环消息（无 parent_tool_use_id）不受 text 抑制影响', () => {
        expect(shouldSuppressStreamMessage({ uuid: 'u-9', parent_tool_use_id: null, message: textMessage('主回答') }, new Set())).toBe(false);
    });
});

describe('ForkedSkillAppendPayloadSchema', () => {
    const valid = {
        skill: 'code-review',
        uuid: 'u-1',
        door: 'response',
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: '…' }] },
    };

    it('合法载荷：额外字段透传、truncated 可选', () => {
        expect(ForkedSkillAppendPayloadSchema.safeParse(valid).success).toBe(true);
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, truncated: true }).success).toBe(true);
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, truncated: 'yes' }).success).toBe(false);
    });

    it('skill 只认 code-review', () => {
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, skill: 'frontend-design' }).success).toBe(false);
    });

    it('uuid 不能为空', () => {
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, uuid: '' }).success).toBe(false);
    });

    it('door 限定 response / tool-result', () => {
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, door: 'tool-result' }).success).toBe(true);
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, door: 'attachment' }).success).toBe(false);
    });

    it('message 必须含 content 数组', () => {
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, message: { type: 'assistant' } }).success).toBe(false);
        expect(ForkedSkillAppendPayloadSchema.safeParse({ ...valid, message: { content: 'text' } }).success).toBe(false);
    });
});

describe('契约常量', () => {
    it('信封 type 与 fork 归属标记的锁定值', () => {
        expect(FORKED_SKILL_TAP_ENVELOPE_TYPE).toBe('forked-skill.append');
        expect(CODE_REVIEW_FORK_PARENT_ID).toBe(CODE_REVIEW);
    });
});
