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

// transcript tap hooks 模块单测（spec Testing Decisions）：
// register 的过滤逻辑由 config.mjs 决定；出口失败不影响 next(e)。
// 直接 import plugin 资产源文件（开发态源目录即挂载点，测试锁的就是它）。
// register 经 vi.resetModules 动态 import：模块级 env 缓存（cachedSock）须
// 每用例新实例，静态共享实例会跨用例泄漏缓存状态。

import { describe, it, expect, vi } from 'vitest';
import { matchesAppendRule } from '../../plugins/mobi/hooks/register.js';
import { bridgeEnvelopeType, sessionAppendRules } from '../../plugins/mobi/hooks/config.mjs';
import {
    TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE,
    TRANSCRIPT_TAP_SESSION_APPEND_RULES,
    matchesTranscriptTapTrigger,
} from '@mobi/shared';

async function loadRegister() {
    vi.resetModules();
    return await import('../../plugins/mobi/hooks/register.js');
}

// session.append 事件形状（SessionAppendInput，落盘序列化前的输入，CC 2.1.312 探针
// 实测只有 {message,door,origin,uuid}）：door 顶层、attachment 名在 message.name；
// 唤醒行事件与人工 prompt 元数据完全同形（wakeupSource 落盘时才盖上，事件层拿不到）
const GOAL_EVENT = { door: 'attachment', message: { type: 'attachment', name: 'goal_status' }, uuid: 'u-1', content: [] };
const PROMPT_EVENT = { door: 'prompt', message: { role: 'user', content: 'E2E 验证唤醒' }, origin: { kind: 'unclassified' }, uuid: 'u-w1' };

function setup(env: string | undefined) {
    const fetchImpl = vi.fn(() => Promise.resolve({ status: 204, ok: true, headers: {}, text: '' }));
    const handlers: Record<string, Array<($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown>> = {};
    const on = vi.fn((event: string, matcherOrHook: unknown, maybeHook?: ($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown) => {
        // register 可能带 matcher 预筛（event, matcher, hook）或全量（event, hook）
        (handlers[event] ??= []).push(maybeHook ?? matcherOrHook);
    });
    // $ mock：$.env.get 解析 spawn 注入的 bridge env（沙箱无 process，见 register 头注释）
    const $ = { env: { get: vi.fn(async (name: string) => (name === 'MOBI_BRIDGE_SOCK' ? env : undefined)) }, http: { fetch: fetchImpl } };
    return { fetchImpl, on, handlers, $ };
}

describe('transcript tap (mod hooks module)', () => {
    it('matchesAppendRule（trigger 触发面）：door / message.name 匹配，缺省字段通配', () => {
        expect(matchesAppendRule({ door: 'attachment', name: 'goal_status' }, GOAL_EVENT)).toBe(true);
        expect(matchesAppendRule({ door: 'attachment', name: 'other' }, GOAL_EVENT)).toBe(false);
        expect(matchesAppendRule({ door: 'prompt', name: 'goal_status' }, GOAL_EVENT)).toBe(false);
        expect(matchesAppendRule({ name: 'goal_status' }, GOAL_EVENT)).toBe(true);
        expect(matchesAppendRule({}, GOAL_EVENT)).toBe(true);
        expect(matchesAppendRule({ door: 'prompt' }, PROMPT_EVENT)).toBe(true);
        expect(matchesAppendRule({ door: 'prompt' }, GOAL_EVENT)).toBe(false);
    });

    it('事件层无 wakeupSource（落盘时才盖上）：field 维度在 trigger 上恒 false——宽触发是唯一解', () => {
        expect(matchesAppendRule({ door: 'prompt', field: 'wakeupSource' }, PROMPT_EVENT)).toBe(false);
    });

    it('envelopeForRule：规则自带 envelope 优先，缺省回落 bridgeEnvelopeType', async () => {
        const { envelopeForRule } = await loadRegister();
        expect(envelopeForRule({ trigger: { door: 'prompt' }, envelope: 'wakeup.append' })).toBe('wakeup.append');
        expect(envelopeForRule({ trigger: { door: 'attachment', name: 'goal_status' } })).toBe('goal.append');
    });

    it('config.mjs 与 shared 契约单源等值：生产端过滤 = 消费端认行（漂移即测试失败）', () => {
        expect(sessionAppendRules).toEqual(TRANSCRIPT_TAP_SESSION_APPEND_RULES);
    });

    it('config.mjs 与 shared 契约单源等值：信封 type 一致且为 goal.append', () => {
        expect(bridgeEnvelopeType).toBe(TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE);
        expect(bridgeEnvelopeType).toBe('goal.append');
    });

    it('register：规则跨多 door → 全量监听 session.append（无 matcher 预筛，行级判定兜底）', async () => {
        const { register } = await loadRegister();
        const { on } = setup(undefined);
        register(on, {});
        expect(on).toHaveBeenCalledWith('session.append', expect.any(Function));
    });

    it('生产端判别式与 shared matchesTranscriptTapTrigger 语义等值（全部规则 × 事件夹具）', () => {
        for (const rule of TRANSCRIPT_TAP_SESSION_APPEND_RULES) {
            for (const event of [GOAL_EVENT, PROMPT_EVENT]) {
                expect(matchesAppendRule(rule.trigger, event)).toBe(matchesTranscriptTapTrigger(event, rule.trigger));
            }
        }
    });

    it('有 env：命中规则 → 经 $.http.fetch 推信封（socketPath+仅元数据）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup('/tmp/bridge.sock');
        register(on, {});
        expect(on).toHaveBeenCalledWith('session.append', expect.any(Function));

        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) h($, GOAL_EVENT, next);

        // fire-and-forget：fetch 已发起即可，不 await
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const [url, init] = fetchImpl.mock.calls[0] as [string, { socketPath: string; body: string; method: string }];
        expect(url).toBe('http://mobi-bridge/session-append');
        expect(init.method).toBe('POST');
        expect(init.socketPath).toBe('/tmp/bridge.sock');
        expect(JSON.parse(init.body)).toEqual({
            type: 'goal.append',
            payload: { door: 'attachment', name: 'goal_status', uuid: 'u-1' },
        });
        // 放行不依赖出口结果
        expect(next).toHaveBeenCalledWith(GOAL_EVENT);
    });

    it('prompt 事件（人工/唤醒同形）→ 独立信封 wakeup.append；人工 prompt 也触发（消费端权威判定）', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup('/tmp/bridge.sock');
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) h($, PROMPT_EVENT, next);

        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const [url, init] = fetchImpl.mock.calls[0] as [string, { socketPath: string; body: string; method: string }];
        expect(JSON.parse(init.body)).toEqual({
            type: 'wakeup.append',
            payload: { door: 'prompt', name: undefined, uuid: 'u-w1' },
        });
        expect(next).toHaveBeenCalledWith(PROMPT_EVENT);
    });

    it('未命中规则：不 fetch，next(e) 照常放行', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup('/tmp/bridge.sock');
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) {
            h($, { door: 'attachment', message: { type: 'attachment', name: 'other' }, uuid: 'u-2' }, next);
            h($, { door: 'response', message: { role: 'assistant' }, uuid: 'u-3' }, next);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(2);
    });

    it('env 未注入（bridge 未起）：hook 空转不 fetch，next(e) 放行', async () => {
        const { register } = await loadRegister();
        const { fetchImpl, on, handlers, $ } = setup(undefined);
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) h($, GOAL_EVENT, next);
        // env 解析完成且未触发 fetch
        await vi.waitFor(() => expect($.env.get).toHaveBeenCalled());
        expect(next).toHaveBeenCalledWith(GOAL_EVENT);
    });

    it('出口 reject / 永不 resolve：next(e) 仍被调用（失败绝不阻塞落盘链路）', async () => {
        const { register } = await loadRegister();
        const { on, handlers, $ } = setup('/tmp/bridge.sock');
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        const rejecting = { env: $.env, http: { fetch: () => Promise.reject(new Error('ECONNREFUSED')) } };
        for (const h of handlers['session.append']) h(rejecting, GOAL_EVENT, next);
        expect(next).toHaveBeenCalledWith(GOAL_EVENT);

        const next2 = vi.fn((e: unknown) => e);
        const pending = { env: $.env, http: { fetch: () => new Promise(() => {}) } };
        for (const h of handlers['session.append']) h(pending, GOAL_EVENT, next2);
        expect(next2).toHaveBeenCalledWith(GOAL_EVENT);
    });
});
