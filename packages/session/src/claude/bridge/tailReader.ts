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

// 尾部窗口反向分块扫读取器（spec mods-goal-channel「goal 订阅者」节契约）：
// 手写 read(fd, position) 反向定长读（readline 无反向接口），goal_status 行落在
// turn 末尾、距 EOF 通常几 KB——首块（64KB）命中即停，未命中再向前取块，累计到
// 窗口硬上限（256KB）放弃。与 goal 无关的通用读取原语，消费端自行过滤/解析。
//
// 契约要点：
// - 行边界按字节 \n 切分（0x0A 不会出现在 UTF-8 多字节序列中间）；跨块的半行丢弃
// - 并发追加无害：所有位置读锚定在开扫时捕获的 EOF 之内，新字节落在窗口外
// - 截断/重写防护：前后 stat 的 ino/mtime 指纹校验，变化即丢弃重扫一轮
// - 读取前校验 regular file（拒符号链接）
// - 窗口耗尽未命中 → 返回未命中结果，重试节奏由订阅者决定（本层不重试）

import { open, lstat, type FileHandle } from 'node:fs/promises';
import { logger } from '@mobi/node-core/logger';

export interface TailScanOptions {
    /** 单块字节数（默认 64KB 起步） */
    chunkSize?: number;
    /** 累计扫描窗口硬上限（默认 256KB），超过即放弃向前扩窗 */
    maxWindow?: number;
    /**
     * 命中判定：某块切出的行满足判定即停止向前扩窗（首块命中是常态）。
     * 缺省 = 无命中判定，扫满窗口或到文件头为止。
     */
    hitTest?: (line: string) => boolean;
}

export interface TailScanResult {
    /** 窗口内完整行（按文件顺序）；跨块半行已丢弃，空行已过滤 */
    lines: string[];
    /** 窗口未覆盖到文件头（头部截断行已丢弃） */
    truncated: boolean;
    /** 窗口耗尽仍未命中 hitTest（无 hitTest 时恒 false） */
    exhausted: boolean;
}

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_MAX_WINDOW = 256 * 1024;

/**
 * 反向分块扫 transcript 尾部，返回窗口内完整原始行。
 * 指纹变化（截断/重写）时自动丢弃重扫一轮；再变则返回最后一次结果（uuid 去重兜底）。
 */
export async function scanTailLines(filePath: string, opts?: TailScanOptions): Promise<TailScanResult> {
    const result = await scanOnce(filePath, opts);
    if (!result.fingerprintChanged) {
        return result.scan;
    }
    logger.warn(`[TAIL_READER] fingerprint changed during scan (truncated/rewritten?), rescanning once: ${filePath}`);
    const rescanned = await scanOnce(filePath, opts);
    return rescanned.scan;
}

async function scanOnce(filePath: string, opts?: TailScanOptions): Promise<{ scan: TailScanResult; fingerprintChanged: boolean }> {
    const chunkSize = opts?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const maxWindow = opts?.maxWindow ?? DEFAULT_MAX_WINDOW;
    const hitTest = opts?.hitTest;

    // 安全检查：拒符号链接（lstat 不跟随）；文件不存在走空结果（落盘竞态早期/清理竞态）
    let linkStat;
    try {
        linkStat = await lstat(filePath);
    } catch (e) {
        logger.debug(`[TAIL_READER] file unavailable: ${filePath}`, e);
        return { scan: { lines: [], truncated: false, exhausted: Boolean(opts?.hitTest) }, fingerprintChanged: false };
    }
    if (linkStat.isSymbolicLink()) {
        throw new Error(`refusing to scan non-regular file (symlink): ${filePath}`);
    }

    let fd: FileHandle;
    try {
        fd = await open(filePath, 'r');
    } catch (e) {
        logger.debug(`[TAIL_READER] cannot open file: ${filePath}`, e);
        return { scan: { lines: [], truncated: false, exhausted: Boolean(hitTest) }, fingerprintChanged: false };
    }

    try {
        const startStat = await fd.stat();
        if (!startStat.isFile()) {
            throw new Error(`refusing to scan non-regular file: ${filePath}`);
        }
        const startFingerprint = `${startStat.ino}:${startStat.mtimeMs}:${startStat.size}`;

        // 反向定长读：全部位置读锚定在开扫捕获的 EOF（startStat.size）之内
        const chunks: Buffer[] = [];
        let scanned = 0;
        let found = false;
        let end = startStat.size;
        while (end > 0 && scanned < maxWindow) {
            const position = Math.max(0, end - chunkSize);
            const length = end - position;
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await fd.read(buffer, 0, length, position);
            chunks.unshift(buffer.subarray(0, bytesRead));
            scanned += bytesRead;
            end = position;

            // 命中即停：本块（连同已收块）内出现命中行则不再向前扩窗
            if (hitTest) {
                const lines = splitLines(Buffer.concat(chunks), /* truncated */ position > 0);
                if (lines.some(hitTest)) {
                    found = true;
                    break;
                }
            }
        }
        // 有命中判定却扫到窗口上限/文件头都没命中 = 耗尽（订阅者据此决定重试/放弃）
        const exhausted = hitTest !== undefined && !found;

        const truncated = end > 0;
        const lines = splitLines(Buffer.concat(chunks), truncated);

        // 截断/重写防护：扫完再 stat 一次，指纹变化 → 丢弃本轮
        const endStat = await fd.stat();
        const endFingerprint = `${endStat.ino}:${endStat.mtimeMs}:${endStat.size}`;
        const fingerprintChanged = endFingerprint !== startFingerprint || endStat.size < startStat.size;

        return { scan: { lines, truncated, exhausted }, fingerprintChanged };
    } finally {
        await fd.close();
    }
}

/**
 * 按字节 \n 切行（UTF-8 安全：0x0A 不会出现在多字节序列中间，每段独立解码无乱码）。
 * truncated 时丢弃首段（跨块半行）；末尾无 \n 的尾段保留（完整行可能尚未换行收尾，
 * 坏行由消费端 JSON.parse 兜底）；空行过滤。
 */
function splitLines(buffer: Buffer, truncated: boolean): string[] {
    const text = buffer.toString('utf-8');
    let segments = text.split('\n');
    if (truncated && segments.length > 0) {
        segments = segments.slice(1);
    }
    return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}
