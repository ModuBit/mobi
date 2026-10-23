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

// forked skill tap hooks 模块单测（spec Testing Decisions 最高缝）：
// 直接 import plugin 资产源文件（开发态源目录即挂载点），mock $（env/http/agent）与 on。
// 断言外部行为：给事件序列 → 哪些行被推出、推出顺序、payload 形状。
// 模块级状态（agent 判定缓存 / 推送链 / socket 缓存）须每用例新实例 → vi.resetModules。

import { describe, it, expect, vi } from 'vitest';
import {
    appendDoors,
    envelopeType,
    maxMessageChars,
    targetSkill,
} from '../../plugins/mobi-forked-tap/hooks/config.mjs';
import {
    FORKED_SKILL_TAP_DOORS,
    FORKED_SKILL_TAP_ENVELOPE_TYPE,
    FORKED_SKILL_TAP_SKILL,
} from '@mobi/shared';

async function loadRegister() {
    vi.resetModules();
    const { register, matchesForkDescription, fitMessage } = await import('../../plugins/mobi-forked-tap/hooks/register.js');
    return { register, matchesForkDescription, fitMessage };
}

type Hook = ($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown;

function setup(opts: { env?: string; envImpl?: () => Promise<string | undefined>; agents?: unknown[] | (() => Promise<unknown[]>); fetchImpl?: ReturnType<typeof vi.fn> } = {}) {
    const fetchImpl = opts.fetchImpl ?? vi.fn(() => Promise.resolve({ status: 204, ok: true, headers: {}, text: '' }));
    const handlers: Record<string, Hook[]> = {};
    const on = vi.fn((event: string, matcherOrHook: unknown, maybeHook?: Hook) => {
        (handlers[event] ??= []).push((maybeHook ?? matcherOrHook) as Hook);
    });
    const list = vi.fn(typeof opts.agents === 'function' ? opts.agents : async () => opts.agents ?? []);
    const $ = {
        env: {
            get: vi.fn(async (name: string) => {
                if (name !== 'MOBI_BRIDGE_SOCK') return undefined;
                return opts.envImpl ? opts.envImpl() : opts.env;
            }),
        },
        http: { fetch: fetchImpl },
        agent: { list },
        clock: { sleep: vi.fn(async () => {}) },
    };
    return { fetchImpl, on, handlers, list, $ };
}

/** fork 行的非 text 事件（thinking） */
function forkEvent(overrides: Record<string, unknown> = {}) {
    return {
        door: 'response',
        uuid: 'u-1',
        agentId: 'a-1',
        origin: { kind: 'model', model: 'test-model' },
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'thinking', thinking: '……' }] },
        ...overrides,
    };
}

/** 等后台判定/推送链跑完（模块内无定时器，30ms 足够） */
const flush = () => new Promise((r) => setTimeout(r, 30));

function dispatch(handlers: Record<string, Hook[]>, $: unknown, e: unknown) {
    const next = vi.fn((value: unknown) => value);
    for (const hook of handlers['session.append'] ?? []) hook($, e, next);
    return next;
}

function sentPayload(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
    const [, init] = fetchImpl.mock.calls[index] as [string, { body: string; socketPath: string; method: string }];
    return JSON.parse(init.body) as { type: string; payload: Record<string, unknown>; from?: string };
}

describe('forked skill tap (mod hooks module)', () => {
    it('config.mjs 与 shared 契约单源等值：skill / doors / 信封 type', () => {
        expect(targetSkill).toBe(FORKED_SKILL_TAP_SKILL);
        expect(envelopeType).toBe(FORKED_SKILL_TAP_ENVELOPE_TYPE);
        expect(appendDoors).toEqual([...FORKED_SKILL_TAP_DOORS]);
        expect(maxMessageChars).toBe(256 * 1024);
    });

    it('matchesForkDescription：精确到首词（`/code-review-x` 与自然语言描述不命中）', async () => {
        const { matchesForkDescription } = await loadRegister();
        expect(matchesForkDescription('/code-review')).toBe(true);
        expect(matchesForkDescription('/code-review 检查最近改动')).toBe(true);
        expect(matchesForkDescription('/code-review-x')).toBe(false);
        expect(matchesForkDescription('Review the recent diff')).toBe(false);
        expect(matchesForkDescription(undefined)).toBe(false);
    });

    it('register：监听 session.append 且 matcher 预筛两个 door', async () => {
        const { register } = await loadRegister();
        const { on } = setup();
        register(on);
        expect(on).toHaveBeenCalledWith(
            'session.append',
            { door: ['response', 'tool-result'], agentId: expect.any(RegExp) },
            expect.any(Function),
        );
    });

    it('fork 行 + 非 text：推信封（type/skill/uuid/door/message/from）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);

        const event = forkEvent();
        const next = dispatch(handlers, $, event);
        // 中间件立即放行，不等待判定/推送
        expect(next).toHaveBeenCalledWith(event);

        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const [url, init] = fetchImpl.mock.calls[0] as [string, { socketPath: string; method: string }];
        expect(url).toBe('http://mobi-bridge/forked-skill-append');
        expect(init.method).toBe('POST');
        expect(init.socketPath).toBe('/tmp/bridge.sock');
        expect(sentPayload(fetchImpl)).toEqual({
            type: 'forked-skill.append',
            payload: { skill: 'code-review', uuid: 'u-1', door: 'response', message: event.message },
            from: 'mobi-forked-tap',
        });
    });

    it('普通 Task 子代理（自然语言描述）：不推', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: 'Review the recent diff' }] });
        register(on);
        dispatch(handlers, $, forkEvent());
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('agent.list 查询失败：保守丢弃（不推且不崩）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({
            env: '/tmp/bridge.sock',
            agents: () => Promise.reject(new Error('list unavailable')),
        });
        register(on);
        const next = dispatch(handlers, $, forkEvent());
        expect(next).toHaveBeenCalled();
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('代理尚未登记：退避复查后命中（首次 list 缺项不永久判否）', async () => {
        const { register } = await loadRegister();
        let calls = 0;
        const { fetchImpl, on, handlers, $ } = setup({
            env: '/tmp/bridge.sock',
            agents: async () => {
                calls += 1;
                return calls === 1 ? [] : [{ id: 'a-1', description: '/code-review' }];
            },
        });
        register(on);
        dispatch(handlers, $, forkEvent());
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        expect($.clock.sleep).toHaveBeenCalled();
    });

    it('message 类型不在 assistant/user 白名单：不推', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        dispatch(handlers, $, forkEvent({ message: { content: [{ type: 'thinking', thinking: '…' }] } }));
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('纯 text 行：不推（text 由主循环最终答复承载）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        dispatch(handlers, $, forkEvent({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: '最终答复' }] } }));
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('主循环行（无 agentId）：不推', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        const event = forkEvent();
        delete (event as { agentId?: string }).agentId;
        dispatch(handlers, $, event);
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('判定期攒行：判定完成前到达的多行按产生顺序推送', async () => {
        const { register } = await loadRegister();
        let resolveList!: (value: unknown[]) => void;
        const pendingList = new Promise<unknown[]>((resolve) => { resolveList = resolve; });
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: () => pendingList });
        register(on);

        // 同一 agent 的三行在判定完成前连续到达（含 tool-result 与 thinking）
        dispatch(handlers, $, forkEvent({ uuid: 'u-1' }));
        dispatch(handlers, $, forkEvent({ uuid: 'u-2', door: 'tool-result', message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-1', content: 'ok' }] } }));
        dispatch(handlers, $, forkEvent({ uuid: 'u-3' }));
        expect(fetchImpl).not.toHaveBeenCalled();

        resolveList([{ id: 'a-1', description: '/code-review' }]);
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
        expect([sentPayload(fetchImpl, 0).payload.uuid, sentPayload(fetchImpl, 1).payload.uuid, sentPayload(fetchImpl, 2).payload.uuid])
            .toEqual(['u-1', 'u-2', 'u-3']);
    });

    it('判定为否时攒住的行全部丢弃', async () => {
        const { register } = await loadRegister();
        let resolveList!: (value: unknown[]) => void;
        const pendingList = new Promise<unknown[]>((resolve) => { resolveList = resolve; });
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: () => pendingList });
        register(on);
        dispatch(handlers, $, forkEvent({ uuid: 'u-1' }));
        resolveList([{ id: 'a-1', description: 'Investigate the bug' }]);
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('超大工具结果：截断后推送并标记 truncated，结构仍完整', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        dispatch(handlers, $, forkEvent({
            door: 'tool-result',
            message: {
                type: 'user',
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 't-1', content: 'x'.repeat(300 * 1024) }],
            },
        }));

        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const payload = sentPayload(fetchImpl).payload as { truncated?: boolean; message: { content: Array<{ type: string }> } };
        expect(payload.truncated).toBe(true);
        expect(payload.message.content[0].type).toBe('tool_result');
        expect(JSON.stringify(payload.message).length).toBeLessThanOrEqual(256 * 1024 + 64);
    });

    it('bridge env 未注入：判定照常但空转不 fetch，next 放行', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: undefined, agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        const next = dispatch(handlers, $, forkEvent());
        await flush();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
    });

    it('出口 reject：next 照常放行，不产生未处理拒绝', async () => {
        const { register } = await loadRegister();
        const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
        const { on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }], fetchImpl });
        register(on);
        const next = dispatch(handlers, $, forkEvent());
        expect(next).toHaveBeenCalled();
        await flush();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('混合 thinking + text：推的内容去掉 text block（避免与主循环最终答复重复）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup({ env: '/tmp/bridge.sock', agents: [{ id: 'a-1', description: '/code-review' }] });
        register(on);
        dispatch(handlers, $, forkEvent({
            message: {
                type: 'assistant',
                role: 'assistant',
                content: [{ type: 'thinking', thinking: '……' }, { type: 'text', text: '最终答复' }],
            },
        }));

        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const payload = sentPayload(fetchImpl).payload as { message: { content: Array<{ type: string }> } };
        expect(payload.message.content.map((block) => block.type)).toEqual(['thinking']);
    });

    it('bridge env 瞬时失败不钉缓存：后续行仍会上桥', async () => {
        const { register } = await loadRegister();
        let calls = 0;
        const { fetchImpl, on, handlers, $ } = setup({
            envImpl: async () => {
                calls += 1;
                if (calls === 1) throw new Error('env not ready');
                return '/tmp/bridge.sock';
            },
            agents: [{ id: 'a-1', description: '/code-review' }],
        });
        register(on);
        dispatch(handlers, $, forkEvent({ uuid: 'u-1' }));
        dispatch(handlers, $, forkEvent({ uuid: 'u-2' }));

        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        expect(sentPayload(fetchImpl).payload.uuid).toBe('u-2');
    });

    it('fitMessage：未超限原样返回；超限截断保留 block 结构', async () => {
        const { fitMessage } = await loadRegister();
        const small = { type: 'assistant', content: [{ type: 'text', text: 'hi' }] };
        expect(fitMessage(small, 1024)).toEqual({ message: small, truncated: false });

        const big = { type: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(10_000) }] };
        const fitted = fitMessage(big, 2048);
        expect(fitted.truncated).toBe(true);
        expect(JSON.stringify(fitted.message).length).toBeLessThanOrEqual(2048);
        expect((fitted.message.content as Array<{ type: string }>)[0].type).toBe('tool_result');
    });

    it('fitMessage：多串中等长度超限时保留全部 block（不掉进前 20 块的兜底）', async () => {
        const { fitMessage } = await loadRegister();
        const blocks = Array.from({ length: 30 }, () => ({
            type: 'tool_result',
            tool_use_id: 't',
            content: 'z'.repeat(10_000),
        }));
        const fitted = fitMessage({ type: 'user', content: blocks });

        expect(fitted.truncated).toBe(true);
        expect((fitted.message.content as unknown[]).length).toBe(30);
        expect(JSON.stringify(fitted.message).length).toBeLessThanOrEqual(256 * 1024);
    });
});
