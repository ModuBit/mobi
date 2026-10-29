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

// wakeup 订阅者集成测试（与 goalTapSubscriber.test 同型：post 信封 → append jsonl →
// 断言 onWakeup 收到解析后的 source）。真 bridge listener + 真 transcript fixture，
// 不断言内部重试节奏/缓冲实现。
// 信号语义（CC 2.1.312 实测）：生产端按 door:'prompt' 宽触发（mods 事件层无
// wakeupSource），信号 uuid 与落盘行 uuid 一致；消费端按行顶层 wakeupSource 权威判定。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { request } from 'node:http';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startBridgeListener, type BridgeListener } from '../../src/claude/bridge/bridgeListener';
import { registerWakeupTapSubscriber } from '../../src/claude/bridge/wakeupTapSubscriber';

let bridge: BridgeListener | null = null;
let fixtureDir: string | null = null;

const WAKEUP_LINE = JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'p-1', type: 'user',
    message: { role: 'user', content: 'E2E 验证唤醒' }, uuid: 'w-1',
    isMeta: true, wakeupSource: 'loop_wakeup', turnOrigin: 'scheduled',
});

const MANUAL_LINE = JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'p-2', type: 'user',
    message: { role: 'user', content: '人工消息' }, uuid: 'm-1',
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
        req.end(JSON.stringify({ type: 'wakeup.append', payload: { door: 'prompt', uuid }, from: 'mobi' }));
    });
}

async function makeTranscript(lines: string[]): Promise<string> {
    fixtureDir = await mkdtemp(join(tmpdir(), 'wakeup-tap-'));
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

describe('wakeupTapSubscriber（bridge 信号 → 解析 wakeupSource）', () => {
    it('行已落盘：post 信封 → onWakeup 收到枚举值，不透传原始行', async () => {
        const file = await makeTranscript(['{"type":"user","uuid":"u-0"}', WAKEUP_LINE]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-wakeup-tap-${randomUUID().slice(0, 8)}.sock` });
        const onWakeup = vi.fn();
        registerWakeupTapSubscriber(bridge, { resolveTranscriptPath: () => file, onWakeup });

        await postSignal('w-1');
        await vi.waitFor(() => expect(onWakeup).toHaveBeenCalledWith('loop_wakeup'));
        expect(onWakeup).toHaveBeenCalledTimes(1);
    });

    it('人工 prompt 行信号（无 wakeupSource）不消费；枚举外取值静默跳过', async () => {
        const unknownSourceLine = JSON.stringify({ type: 'user', uuid: 'w-2', message: {}, wakeupSource: 'future_kind' });
        const file = await makeTranscript([MANUAL_LINE, unknownSourceLine]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-wakeup-tap-${randomUUID().slice(0, 8)}.sock` });
        const onWakeup = vi.fn();
        registerWakeupTapSubscriber(bridge, { resolveTranscriptPath: () => file, onWakeup });

        // 人工 prompt 行的信号（uuid = 人工行 uuid）：扫尾窗但无唤醒行可消费，静默收场
        await postSignal('m-1');
        // 补偿信号（扫描尾窗）：只有未来枚值行候选——枚举外不消费
        await postSignal('compensate-1');
        await new Promise((r) => setTimeout(r, 400));
        expect(onWakeup).not.toHaveBeenCalled();
    });

    it('uuid 去重：同一行重复信号只消费一次', async () => {
        const file = await makeTranscript([WAKEUP_LINE]);
        bridge = await startBridgeListener({ socketPath: `/tmp/mobi-wakeup-tap-${randomUUID().slice(0, 8)}.sock` });
        const onWakeup = vi.fn();
        registerWakeupTapSubscriber(bridge, { resolveTranscriptPath: () => file, onWakeup });

        await postSignal('w-1');
        await vi.waitFor(() => expect(onWakeup).toHaveBeenCalledTimes(1));
        await postSignal('w-1');
        await new Promise((r) => setTimeout(r, 400));
        expect(onWakeup).toHaveBeenCalledTimes(1);
    });
});
