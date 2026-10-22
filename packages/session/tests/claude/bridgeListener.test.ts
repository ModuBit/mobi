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

// bridge listener UDS 缝单测（spec Testing Decisions）：真 Unix socket 起服，
// post 信封断言订阅者收到；不断言内部缓冲/重试实现。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startBridgeListener } from '../../src/claude/bridge/bridgeListener';

let socketPath: string;
let stop: (() => Promise<void>) | null = null;

/** UDS 路径上限 ~104B（macOS），测试 socket 用短路径 /tmp 直挂（生产为 {mobiHome}/bridge/） */
function testSocketPath(): string {
    return `/tmp/mobi-bridge-test-${randomUUID().slice(0, 8)}.sock`;
}

function post(body: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = request({
            socketPath,
            path: '/session-append',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end(body);
    });
}

afterEach(async () => {
    await stop?.();
    stop = null;
});

describe('bridgeListener', () => {
    it('post 信封 → 按 type 分发给订阅者（payload 与 from 原样透传）', async () => {
        socketPath = testSocketPath();
        const bridge = await startBridgeListener({ socketPath });
        stop = () => bridge.stop();

        const subscriber = vi.fn();
        bridge.subscribe('session.append', subscriber);
        // 供时序：post 前订阅已就绪（startBridgeListener resolve 即已 listen）
        const status = await post(JSON.stringify({
            type: 'session.append',
            payload: { door: 'attachment', name: 'goal_status', uuid: 'u-1' },
            from: 'mobi-tap',
        }));
        expect(status).toBe(204);
        expect(subscriber).toHaveBeenCalledWith(
            { door: 'attachment', name: 'goal_status', uuid: 'u-1' },
            'mobi-tap',
        );
    });

    it('同一 type 多个订阅者都收到', async () => {
        socketPath = testSocketPath();
        const bridge = await startBridgeListener({ socketPath });
        stop = () => bridge.stop();

        const a = vi.fn();
        const b = vi.fn();
        bridge.subscribe('session.append', a);
        bridge.subscribe('session.append', b);
        await post(JSON.stringify({ type: 'session.append', payload: { uuid: 'u-2' } }));
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('未知 type 忽略（不崩、不投递）', async () => {
        socketPath = testSocketPath();
        const bridge = await startBridgeListener({ socketPath });
        stop = () => bridge.stop();

        const subscriber = vi.fn();
        bridge.subscribe('session.append', subscriber);
        const status = await post(JSON.stringify({ type: 'other.event', payload: {} }));
        expect(status).toBe(204);
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('坏 JSON / 缺 type 的信封静默忽略', async () => {
        socketPath = testSocketPath();
        const bridge = await startBridgeListener({ socketPath });
        stop = () => bridge.stop();

        const subscriber = vi.fn();
        bridge.subscribe('session.append', subscriber);
        expect(await post('not-json')).toBe(204);
        expect(await post(JSON.stringify({ payload: {} }))).toBe(204);
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('stop 后 socket 文件清理且服务不再受理', async () => {
        socketPath = testSocketPath();
        const bridge = await startBridgeListener({ socketPath });
        await bridge.stop();
        expect(existsSync(socketPath)).toBe(false);
        await expect(post('{}')).rejects.toThrow();
    });
});
