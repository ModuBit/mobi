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

// goal 订阅者集成测试（spec Testing Decisions：post 信封 → append jsonl → 断言透传）：
// 真 bridge listener + 真 transcript fixture，不断言内部重试节奏/缓冲实现。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { request } from 'node:http';
import { writeFile, appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startBridgeListener, type BridgeListener } from '../../src/claude/bridge/bridgeListener';
import { registerGoalTapSubscriber } from '../../src/claude/bridge/goalTapSubscriber';
import type { RawJSONLines } from '../../src/claude/types';

let bridge: BridgeListener | null = null;
let fixtureDir: string | null = null;

const GOAL_LINE = JSON.stringify({
    type: 'attachment', uuid: 'g-1', timestamp: '2026-10-22T00:00:00Z',
    attachment: { type: 'goal_status', met: false, condition: '所有测试通过', iterations: 1, sentinel: true },
});

function postSignal(uuid: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = request({
            socketPath: bridge!.socketPath,
            path: '/session-append',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
        }, (res) => {
            res.resume();
            res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end(JSON.stringify({ type: 'goal.append', payload: { door: 'attachment', name: 'goal_status', uuid }, from: 'mobi' }));
    });
}

async function makeTranscript(lines: string[]): Promise<string> {
    fixtureDir = await mkdtemp(join(tmpdir(), 'goal-tap-'));
    const file = join(fixtureDir, 'session.jsonl');
    await writeFile(file, lines.map((l) => l + '\n').join(''));
    return file;
}

afterEach(async () => {
    await bridge?.stop();
    bridge = null;
    if (fixtureDir) {
        await rm(fixtureDir, { recursive: true, force: true });
        fixtureDir = null;
    }
});

describe('goalTapSubscriber（bridge 信号 → 原始行透传）', () => {
    it('行已落盘：post 信封 → 原始行逐字节透传进消息管道', async () => {
        const file = await makeTranscript(['{"type":"user","uuid":"u-0"}', GOAL_LINE]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, {
            resolveTranscriptPath: () => file,
            sendMessage,
        });

        await postSignal('g-1');
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        const message = sendMessage.mock.calls[0][0] as RawJSONLines;
        expect(message.type).toBe('attachment');
        expect(message.uuid).toBe('g-1');
        // 原始行逐字节一致（无字段转换/合成）
        expect(JSON.stringify(message.attachment)).toBe(JSON.stringify((JSON.parse(GOAL_LINE) as { attachment: unknown }).attachment));
    });

    it('落盘竞态：信号先到、行后落盘 → 退避重试后仍透传', async () => {
        const file = await makeTranscript(['{"type":"user","uuid":"u-0"}']);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, { resolveTranscriptPath: () => file, sendMessage });

        // 信号先发，行延迟落盘（落盘竞态窗口内）
        await postSignal('g-1');
        await new Promise((r) => setTimeout(r, 80));
        await appendFile(file, GOAL_LINE + '\n');

        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1), { timeout: 2000 });
        expect((sendMessage.mock.calls[0][0] as RawJSONLines).uuid).toBe('g-1');
    });

    it('uuid 去重：同一行的重复信号只透传一次', async () => {
        const file = await makeTranscript([GOAL_LINE]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, { resolveTranscriptPath: () => file, sendMessage });

        await postSignal('g-1');
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
        await postSignal('g-1');
        await new Promise((r) => setTimeout(r, 400));
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('非 goal 的 attachment 行（hitTest 误命中）不透传：行匹配由 shared 契约推导', async () => {
        const OTHER_LINE = JSON.stringify({
            type: 'attachment', uuid: 'o-1', timestamp: '2026-10-22T00:00:00Z',
            attachment: { type: 'future_thing', note: 'text mentions goal_status' },
        });
        const file = await makeTranscript([OTHER_LINE]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, { resolveTranscriptPath: () => file, sendMessage });

        await postSignal('o-1');
        await new Promise((r) => setTimeout(r, 600));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('窗口耗尽无 goal 行：不透传不崩（放弃 + warn 场景）', async () => {
        const file = await makeTranscript(['{"type":"user","uuid":"u-0"}', '{"type":"user","uuid":"u-1"}']);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, { resolveTranscriptPath: () => file, sendMessage });

        await postSignal('missing-uuid');
        // 退避轮（3 次重试）走完后仍无行
        await new Promise((r) => setTimeout(r, 700));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('transcript 路径未就绪：信号丢弃不崩', async () => {
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-goal-tap-${randomUUID().slice(0, 8)}.sock` });
        const sendMessage = vi.fn();
        registerGoalTapSubscriber(bridge, { resolveTranscriptPath: () => null, sendMessage });

        await postSignal('g-1');
        await new Promise((r) => setTimeout(r, 200));
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
