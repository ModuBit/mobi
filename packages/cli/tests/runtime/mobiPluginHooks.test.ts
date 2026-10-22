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
// register 的过滤逻辑由 config.json 决定；出口失败不影响 next(e)。
// 直接 import plugin 资产源文件（开发态源目录即挂载点，测试锁的就是它）。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { register, matchesAppendRule } from '../../plugins/mobi/hooks/register.js';

const GOAL_EVENT = { door: 'attachment', name: 'goal_status', uuid: 'u-1', content: [] };

function setup(env: string | undefined) {
    if (env === undefined) {
        delete process.env.MOBI_BRIDGE_SOCK;
    } else {
        process.env.MOBI_BRIDGE_SOCK = env;
    }
    const fetchImpl = vi.fn(() => Promise.resolve({ status: 204, ok: true, headers: {}, text: '' }));
    const handlers: Record<string, Array<($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown>> = {};
    const on = vi.fn((event: string, handler: ($: unknown, e: unknown, next: (e: unknown) => unknown) => unknown) => {
        (handlers[event] ??= []).push(handler);
    });
    return { fetchImpl, on, handlers };
}

afterEach(() => {
    delete process.env.MOBI_BRIDGE_SOCK;
});

describe('transcript tap (mod hooks module)', () => {
    it('matchesAppendRule：door/name 全匹配才命中，缺省字段通配', () => {
        expect(matchesAppendRule({ door: 'attachment', name: 'goal_status' }, GOAL_EVENT)).toBe(true);
        expect(matchesAppendRule({ door: 'attachment', name: 'other' }, GOAL_EVENT)).toBe(false);
        expect(matchesAppendRule({ door: 'prompt', name: 'goal_status' }, GOAL_EVENT)).toBe(false);
        expect(matchesAppendRule({ name: 'goal_status' }, GOAL_EVENT)).toBe(true);
        expect(matchesAppendRule({}, GOAL_EVENT)).toBe(true);
    });

    it('无 MOBI_BRIDGE_SOCK：不注册任何事件（mod 空转）', () => {
        const { on } = setup(undefined);
        register(on, {});
        expect(on).not.toHaveBeenCalled();
    });

    it('有 env：注册 session.append；命中规则 → 经 $.http.fetch 推信封（socketPath+仅元数据）', async () => {
        const { fetchImpl, on, handlers } = setup('/tmp/bridge.sock');
        register(on, {});
        expect(on).toHaveBeenCalledWith('session.append', expect.any(Function));

        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) h({ http: { fetch: fetchImpl } }, GOAL_EVENT, next);

        // fire-and-forget：fetch 已发起即可，不 await
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
        const [url, init] = fetchImpl.mock.calls[0] as [string, { socketPath: string; body: string; method: string }];
        expect(url).toBe('http://mobi-bridge/session-append');
        expect(init.method).toBe('POST');
        expect(init.socketPath).toBe('/tmp/bridge.sock');
        expect(JSON.parse(init.body)).toEqual({
            type: 'session.append',
            payload: { door: 'attachment', name: 'goal_status', uuid: 'u-1' },
        });
        // 放行不依赖出口结果
        expect(next).toHaveBeenCalledWith(GOAL_EVENT);
    });

    it('未命中规则：不 fetch，next(e) 照常放行', () => {
        const { fetchImpl, on, handlers } = setup('/tmp/bridge.sock');
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        for (const h of handlers['session.append']) {
            h({ http: { fetch: fetchImpl } }, { door: 'attachment', name: 'other', uuid: 'u-2' }, next);
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('出口 reject / 永不 resolve：next(e) 仍被调用（失败绝不阻塞落盘链路）', () => {
        const { on, handlers } = setup('/tmp/bridge.sock');
        register(on, {});
        const next = vi.fn((e: unknown) => e);
        const rejecting = { http: { fetch: () => Promise.reject(new Error('ECONNREFUSED')) } };
        for (const h of handlers['session.append']) h(rejecting, GOAL_EVENT, next);
        expect(next).toHaveBeenCalledWith(GOAL_EVENT);

        const next2 = vi.fn((e: unknown) => e);
        const pending = { http: { fetch: () => new Promise(() => {}) } };
        for (const h of handlers['session.append']) h(pending, GOAL_EVENT, next2);
        expect(next2).toHaveBeenCalledWith(GOAL_EVENT);
    });
});
