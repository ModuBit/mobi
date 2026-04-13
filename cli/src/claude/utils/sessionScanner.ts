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

import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { logger } from "@/ui/logger";
import { getProjectPath } from "./path";
import { BaseSessionScanner, SessionFileScanEntry, SessionFileScanResult, SessionFileScanStats } from "@/modules/common/session/BaseSessionScanner";

/**
 * Claude Code 内部事件类型，需要在扫描时静默跳过。
 *
 * 这些事件由 Claude Code CLI 写入 session JSONL 文件，但并非实际的对话消息，
 * 而是 Claude Code 内部用于状态跟踪和管理的记录事件：
 *
 * - file-history-snapshot: 文件历史快照，记录工作目录中文件的状态
 * - change: 变更事件，跟踪文件系统或内部状态的变化
 * - queue-operation: 队列操作，管理内部任务队列的状态
 *
 * 过滤原因：这些事件与用户-助手对话无关，结构也不同，保留它们会导致解析问题。
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

export async function createSessionScanner(opts: {
    sessionId: string | null;
    workingDirectory: string;
    onMessage: (message: RawJSONLines) => void;
}) {
    const scanner = new ClaudeSessionScanner({
        sessionId: opts.sessionId,
        workingDirectory: opts.workingDirectory,
        onMessage: opts.onMessage
    });

    await scanner.start();

    return {
        cleanup: async () => {
            await scanner.cleanup();
        },
        onNewSession: (sessionId: string) => {
            scanner.onNewSession(sessionId);
        }
    };
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


class ClaudeSessionScanner extends BaseSessionScanner<RawJSONLines> {
    private readonly projectDir: string;
    private readonly onMessage: (message: RawJSONLines) => void;
    /** 已完成扫描的会话ID集合，用于避免重复处理已扫描过的会话 */
    private readonly finishedSessions = new Set<string>();
    /** 待扫描的会话ID集合，当切换到新会话时，旧会话暂存于此等待后续扫描 */
    private readonly pendingSessions = new Set<string>();
    /** 当前正在进行的会话ID */
    private currentSessionId: string | null;
    /** 本轮扫描过程中已扫描的会话ID集合，用于扫描完成后更新会话状态（将pending移至finished） */
    private readonly scannedSessions = new Set<string>();

    constructor(opts: { sessionId: string | null; workingDirectory: string; onMessage: (message: RawJSONLines) => void }) {
        super({ intervalMs: 3000 });
        this.projectDir = getProjectPath(opts.workingDirectory);
        this.onMessage = opts.onMessage;
        this.currentSessionId = opts.sessionId;
    }

    public onNewSession(sessionId: string): void {
        if (this.currentSessionId === sessionId) {
            return;
        }
        if (this.finishedSessions.has(sessionId)) {
            return;
        }
        if (this.pendingSessions.has(sessionId)) {
            return;
        }
        if (this.currentSessionId) {
            this.pendingSessions.add(this.currentSessionId);
        }
        logger.debug(`[SESSION_SCANNER] onNewSession: ${this.currentSessionId ?? '(none)'} → ${sessionId}`);
        this.currentSessionId = sessionId;
        this.invalidate();
    }

    protected async initialize(): Promise<void> {
        if (!this.currentSessionId) {
            return;
        }
        const sessionFile = this.sessionFilePath(this.currentSessionId);
        const { events, totalLines } = await readSessionLog(sessionFile, 0);
        logger.debug(`[SESSION_SCANNER] initialize: sessionId=${this.currentSessionId}, seeding ${events.length} existing messages as processed`);
        const keys = events.map((entry) => messageKey(entry.event));
        this.seedProcessedKeys(keys);
        this.setCursor(sessionFile, totalLines);
    }

    protected async beforeScan(): Promise<void> {
        this.scannedSessions.clear();
    }

    protected async findSessionFiles(): Promise<string[]> {
        const files = new Set<string>();
        for (const sessionId of this.pendingSessions) {
            files.add(this.sessionFilePath(sessionId));
        }
        if (this.currentSessionId && !this.pendingSessions.has(this.currentSessionId)) {
            files.add(this.sessionFilePath(this.currentSessionId));
        }
        for (const watched of this.getWatchedFiles()) {
            files.add(watched);
        }
        return [...files];
    }

    protected async parseSessionFile(filePath: string, cursor: number): Promise<SessionFileScanResult<RawJSONLines>> {
        const sessionId = sessionIdFromPath(filePath);
        if (sessionId) {
            this.scannedSessions.add(sessionId);
        }
        const { events, totalLines } = await readSessionLog(filePath, cursor);
        return {
            events,
            nextCursor: totalLines
        };
    }

    protected generateEventKey(event: RawJSONLines): string {
        return messageKey(event);
    }

    protected async handleFileScan(stats: SessionFileScanStats<RawJSONLines>): Promise<void> {
        for (const message of stats.events) {
            const id = message.type === 'summary' ? message.leafUuid : message.uuid;
            logger.debug(`[SESSION_SCANNER] Sending new message: type=${message.type}, uuid=${id}`);
            this.onMessage(message);
        }
        if (stats.parsedCount > 0) {
            const sessionId = sessionIdFromPath(stats.filePath) ?? 'unknown';
            logger.debug(`[SESSION_SCANNER] Session ${sessionId}: found=${stats.parsedCount}, skipped=${stats.skippedCount}, sent=${stats.newCount}`);
        }
    }

    protected async afterScan(): Promise<void> {
        for (const sessionId of this.scannedSessions) {
            if (this.pendingSessions.has(sessionId)) {
                this.pendingSessions.delete(sessionId);
                this.finishedSessions.add(sessionId);
            }
        }

        // 清理已结束会话的 watcher，防止 /compact 等操作导致旧 watcher 累积
        const keepFiles = new Set<string>();
        for (const sessionId of this.pendingSessions) {
            keepFiles.add(this.sessionFilePath(sessionId));
        }
        if (this.currentSessionId) {
            keepFiles.add(this.sessionFilePath(this.currentSessionId));
        }
        this.pruneWatchers(keepFiles);
    }

    private sessionFilePath(sessionId: string): string {
        return join(this.projectDir, `${sessionId}.jsonl`);
    }
}

//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else {
        throw Error() // Impossible
    }
}

/**
 * Read and parse session log file.
 * Returns only valid conversation messages, silently skipping internal events.
 */
async function readSessionLog(filePath: string, startLine: number): Promise<{ events: SessionFileScanEntry<RawJSONLines>[]; totalLines: number }> {
    logger.debug(`[SESSION_SCANNER] Reading session file: ${filePath}`);
    let file: string;
    try {
        file = await readFile(filePath, 'utf-8');
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${filePath}`);
        return { events: [], totalLines: startLine };
    }
    const lines = file.split('\n');
    const hasTrailingEmpty = lines.length > 0 && lines[lines.length - 1] === '';
    const totalLines = hasTrailingEmpty ? lines.length - 1 : lines.length;
    let effectiveStartLine = startLine;
    if (effectiveStartLine > totalLines) {
        effectiveStartLine = 0;
    }
    const messages: SessionFileScanEntry<RawJSONLines>[] = [];
    for (let index = effectiveStartLine; index < lines.length; index += 1) {
        const l = lines[index];
        try {
            if (l.trim() === '') {
                continue;
            }
            let message = JSON.parse(l);
            
            // Silently skip known internal Claude Code events
            // These are state/tracking events, not conversation messages
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue;
            }
            
            let parsed = RawJSONLinesSchema.safeParse(message);
            if (!parsed.success) {
                // Unknown message types are silently skipped.
                continue;
            }
            messages.push({ event: parsed.data, lineIndex: index });
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
            continue;
        }
    }
    return { events: messages, totalLines };
}

function sessionIdFromPath(filePath: string): string | null {
    const base = basename(filePath);
    if (!base.endsWith('.jsonl')) {
        return null;
    }
    return base.slice(0, -'.jsonl'.length);
}
