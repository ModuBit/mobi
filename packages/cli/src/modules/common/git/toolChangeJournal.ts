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

/**
 * 工具层变更记录（ToolChangeJournal，审查重写 v2 spec 2.1）——turn 档的兜底事实源：
 * 从 CC 原生 toolUseResult 采集 structuredPatch 同源的 originalFile / content，按 path
 * 归并（before 取首次、after 取末次、writeCount 累加）。
 *
 * 消费方（票 04 resolver）：非 git 目录的降级源、gitignored 文件的补入源。
 * 落盘：`.mobi/turn-diffs/<sessionId>/tool-changes.json`（与 turn 快照引用的
 * refs/mobi/turn-diffs/<sessionId> 同一会话子树约定），record 触发 500ms 去抖原子写；
 * 重启会话 restore 恢复。损坏文件容错：解析失败按空 journal 起步（事实源宁可缺失
 * 不阻塞主流程）。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 归并后的单文件变更事实 */
export type ToolChangeEntry = {
    /** 首次观测到的文件内容（未观测到则为 null——如新建文件的 Write） */
    beforeContent: string | null
    /** 末次观测到的文件内容（CC 只在 Write 类结果给 content，Edit 类缺省保持 null） */
    afterContent: string | null
    /** 该路径被记录的写入次数 */
    writeCount: number
    /** 写过该路径的工具名（保序去重） */
    toolNames: string[]
}

/** 落盘/restore 的 wire 形状：path → entry */
export type ToolChangeSnapshot = { files: Record<string, ToolChangeEntry> }

/** record 入参（afterContent 缺省 = 本条只补 before 占位，不覆盖末次内容） */
export type ToolChangeRecordInput = {
    path: string
    beforeContent: string | null
    afterContent?: string
    toolName: string
}

/** 归并与序列化逻辑收口在本类（纯内存，I/O 在 PersistentToolChangeJournal） */
export class ToolChangeJournal {
    private readonly files = new Map<string, ToolChangeEntry>()

    /** 同 path 归并：before 取首次、after 取末次（显式传入才覆盖）、writeCount 累加 */
    record(entry: ToolChangeRecordInput): void {
        const existing = this.files.get(entry.path)
        if (existing) {
            existing.afterContent = entry.afterContent ?? existing.afterContent
            existing.writeCount += 1
            if (!existing.toolNames.includes(entry.toolName)) existing.toolNames.push(entry.toolName)
        } else {
            this.files.set(entry.path, {
                beforeContent: entry.beforeContent,
                afterContent: entry.afterContent ?? null,
                writeCount: 1,
                toolNames: [entry.toolName],
            })
        }
    }

    snapshot(): ToolChangeSnapshot {
        const files: Record<string, ToolChangeEntry> = {}
        for (const [path, entry] of this.files) files[path] = { ...entry, toolNames: [...entry.toolNames] }
        return { files }
    }

    listPaths(): string[] {
        return [...this.files.keys()]
    }

    get(path: string): ToolChangeEntry | undefined {
        const entry = this.files.get(path)
        return entry ? { ...entry, toolNames: [...entry.toolNames] } : undefined
    }

    /** 从落盘 JSON 恢复（逐条形状过滤，坏条目跳过不抛） */
    static restore(raw: unknown): ToolChangeJournal {
        const journal = new ToolChangeJournal()
        const files = (raw as ToolChangeSnapshot | null | undefined)?.files
        if (!files || typeof files !== 'object') return journal
        for (const [path, entry] of Object.entries(files)) {
            if (typeof path !== 'string' || path.length === 0 || !entry || typeof entry !== 'object') continue
            const e = entry as Partial<ToolChangeEntry>
            journal.files.set(path, {
                beforeContent: typeof e.beforeContent === 'string' ? e.beforeContent : null,
                afterContent: typeof e.afterContent === 'string' ? e.afterContent : null,
                writeCount: typeof e.writeCount === 'number' && Number.isFinite(e.writeCount) ? e.writeCount : 1,
                toolNames: Array.isArray(e.toolNames) ? e.toolNames.filter((n): n is string => typeof n === 'string') : [],
            })
        }
        return journal
    }
}

/** 工具层变更文件的落盘路径：工作区 `.mobi/turn-diffs/<sessionId>/tool-changes.json` */
export function getToolChangesPath(workspaceRoot: string, sessionId: string): string {
    // 与 gitTurnSnapshotStore 的 refname 白名单同一字符面，兜底保路径合法
    const safeId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
    return join(workspaceRoot, '.mobi', 'turn-diffs', safeId, 'tool-changes.json')
}

/** 只读装载（RPC handler 消费）：文件不存在/损坏按空 journal——兜底源宁可缺失不阻塞查询 */
export async function loadToolChangeJournal(filePath: string): Promise<ToolChangeJournal> {
    try {
        return ToolChangeJournal.restore(JSON.parse(await readFile(filePath, 'utf8')))
    } catch {
        return new ToolChangeJournal()
    }
}

/**
 * 带落盘调度的持久化 journal：launcher/reporter 依赖的形态——record 即调度去抖写，
 * flush/dispose 收口刷盘。原子写（tmp + rename）防半截 JSON。
 */
export class PersistentToolChangeJournal {
    private timer: ReturnType<typeof setTimeout> | null = null
    private pending: Promise<void> = Promise.resolve()

    private constructor(
        private readonly filePath: string,
        readonly journal: ToolChangeJournal,
        private readonly debounceMs: number,
    ) {}

    /** 打开：读既有文件恢复（不存在/损坏按空起步） */
    static async open(filePath: string, options?: { debounceMs?: number }): Promise<PersistentToolChangeJournal> {
        return new PersistentToolChangeJournal(filePath, await loadToolChangeJournal(filePath), options?.debounceMs ?? 500)
    }

    /** 透传记录并调度去抖落盘 */
    record(entry: ToolChangeRecordInput): void {
        this.journal.record(entry)
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => {
            this.timer = null
            this.pending = this.pending.then(() => this.write()).catch(() => undefined)
        }, this.debounceMs)
    }

    private async write(): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true })
        const tmp = `${this.filePath}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(this.journal.snapshot()))
        await rename(tmp, this.filePath)
    }

    /** 立即落盘（取消挂起定时器） */
    async flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        this.pending = this.pending.then(() => this.write()).catch(() => undefined)
        await this.pending
    }

    /** 退出前收口：落盘后不再接受新写入（dispose 后 record 仍内存安全，只是不再刷盘） */
    async dispose(): Promise<void> {
        await this.flush()
    }
}
