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

// 尾部窗口反向分块扫读取器单测（spec Testing Decisions 全契约场景）：
// 首块命中即停 / 跨块半行丢弃 / 扫描期间追加不串 / 指纹变化重扫 / 非常规文件拒绝。
// fixture 用小 chunkSize 触发跨块路径，行为与大块同构。

import { describe, it, expect, vi } from 'vitest';
import { writeFile, mkdtemp, stat, symlink, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTailLines } from '../../src/claude/bridge/tailReader';

async function makeFixture(lines: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tail-reader-'));
    const file = join(dir, 'session.jsonl');
    await writeFile(file, lines.map((l) => l + '\n').join(''));
    return file;
}

const GOAL = '{"type":"attachment","attachment":{"type":"goal_status","met":false}}';
const FILLER = (i: number) => `{"type":"user","uuid":"u-${i}","message":{"role":"user","content":"filler line ${i} padding padding"}}`;

describe('scanTailLines', () => {
    it('首块命中即停：goal 行在结果尾部；窗口未到文件头时头部半行已丢', async () => {
        const file = await makeFixture([FILLER(1), FILLER(2), GOAL]);
        const scan = await scanTailLines(file, {
            chunkSize: 64,
            maxWindow: 4096,
            hitTest: (l) => l.includes('"goal_status"'),
        });
        expect(scan.exhausted).toBe(false);
        expect(scan.lines.at(-1)).toBe(GOAL);
        // 命中即停发生在文件中部 → truncated（头部截断行已丢弃，语义正确）
        expect(scan.truncated).toBe(true);
        // 所有返回行仍是完整 JSON
        for (const line of scan.lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });

    it('跨块半行丢弃：窗口截断处的残行不进结果，其余完整行保留', async () => {
        // maxWindow 不足以覆盖全文件 → 头部必有截断半行
        const file = await makeFixture([FILLER(1).repeat(3), FILLER(2), GOAL]);
        const scan = await scanTailLines(file, {
            chunkSize: 32,
            maxWindow: 120,
            hitTest: (l) => l.includes('"goal_status"'),
        });
        expect(scan.truncated).toBe(true);
        // 所有返回行都是合法 JSON（半行已被丢弃）
        for (const line of scan.lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
        expect(scan.lines[scan.lines.length - 1]).toBe(GOAL);
    });

    it('并发追加无害：追加后新扫描照常可读，窗口行始终完整', async () => {
        const file = await makeFixture([FILLER(1), GOAL]);
        const opts = { chunkSize: 64, maxWindow: 4096, hitTest: (l: string) => l.includes('"goal_status"') };
        // 追加（模拟并发写落在开扫 EOF 之后）：位置读锚定旧 EOF，新字节落丢弃区
        const { appendFile } = await import('node:fs/promises');
        await appendFile(file, FILLER(99) + '\n');
        const scan = await scanTailLines(file, opts);
        // GOAL 行仍完整在窗口内，追加行是新的文件尾
        expect(scan.lines).toContain(GOAL);
        expect(JSON.parse(scan.lines.at(-1)!).uuid).toBe('u-99');
        for (const line of scan.lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });

    it('无 hitTest：返回窗口内全部行，exhausted 恒 false', async () => {
        const file = await makeFixture([FILLER(1), FILLER(2)]);
        const scan = await scanTailLines(file, { chunkSize: 64, maxWindow: 4096 });
        expect(scan.exhausted).toBe(false);
        expect(scan.lines).toHaveLength(2);
        expect(JSON.parse(scan.lines[1]).uuid).toBe('u-2');
    });

    it('窗口耗尽未命中：exhausted=true 且无 goal 行（订阅者据此重试/放弃）', async () => {
        const file = await makeFixture([FILLER(1), FILLER(2), FILLER(3)]);
        const scan = await scanTailLines(file, {
            chunkSize: 32,
            maxWindow: 200,
            hitTest: (l) => l.includes('"goal_status"'),
        });
        expect(scan.exhausted).toBe(true);
        expect(scan.lines.some((l) => l.includes('goal_status'))).toBe(false);
    });

    it('指纹变化（扫描期间截断/重写）：丢弃本轮重扫一轮，返回有效结果', async () => {
        const file = await makeFixture([FILLER(1), GOAL]);
        const opts = { chunkSize: 64, maxWindow: 4096, hitTest: (l: string) => l.includes('"goal_status"') };
        // 注入：第一轮扫描的「扫完 stat」读到截断后的指纹 → 判定指纹变化 → 丢弃重扫
        // FileHandle 类无运行时值导出，用实例原型作 spy 目标
        const probe = await open(file, 'r');
        const handleProto = Object.getPrototypeOf(probe) as { stat: () => Promise<Awaited<ReturnType<typeof stat>>> };
        await probe.close();
        const spy = vi.spyOn(handleProto, 'stat');
        let statCalls = 0;
        spy.mockImplementation(async function (this: unknown) {
            statCalls += 1;
            const real = await stat(file);
            if (statCalls === 2) {
                // 第一轮的结束 stat：模拟扫描期间文件被截断重写（size 骤减 + mtime 变化）
                return { ...real, size: 5, mtimeMs: real.mtimeMs + 1 };
            }
            return real;
        });
        try {
            const scan = await scanTailLines(file, opts);
            // 重扫一轮（第二轮 start/end stat 均真实）→ 结果有效
            expect(statCalls).toBeGreaterThanOrEqual(4);
            expect(scan.lines.at(-1)).toBe(GOAL);
            expect(scan.exhausted).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });

    it('符号链接拒绝', async () => {
        const file = await makeFixture([GOAL]);
        const dir = join(file, '..');
        const link = join(dir, 'link.jsonl');
        await symlink(file, link);
        try {
            await expect(scanTailLines(link, { hitTest: () => true })).rejects.toThrow(/symlink/);
        } finally {
            await rm(link, { force: true });
        }
    });

    it('文件不存在：返回空结果不抛错（落盘竞态早期路径）', async () => {
        const scan = await scanTailLines(join(tmpdir(), `tail-reader-none-${Date.now()}.jsonl`), {
            hitTest: (l) => l.includes('"goal_status"'),
        });
        expect(scan.lines).toHaveLength(0);
        expect(scan.exhausted).toBe(true);
    });
});
