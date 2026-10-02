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
 * 工具层变更归并规则单源（ToolChangeJournal，审查重写 v2 票03 引入）——turn 内按
 * path 归并内容对（before 取首次、after 取末次、writeCount 累加、toolNames 保序
 * 去重）。turn-archive B 后只作 TurnDiffReporter 的每轮内存累积器（全文只进内存，
 * 封口时合成 patch 落归档，全文零进盘；tool-changes.json 持久层已随 B 方案退场）。
 */

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

/** snapshot 的 wire 形状：path → entry */
export type ToolChangeSnapshot = { files: Record<string, ToolChangeEntry> }

/** record 入参（afterContent 缺省 = 本条只补 before 占位，不覆盖末次内容） */
export type ToolChangeRecordInput = {
    path: string
    beforeContent: string | null
    afterContent?: string
    toolName: string
}

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

    /** 只补 afterContent 不计写入次数（异步读盘补全专用——写入计数归属触发读盘的那次
     *  tool_result，已在同步 record 路径 +1，这里再计会翻倍）；路径未记录过则忽略 */
    recordAfter(path: string, afterContent: string, toolName: string): void {
        const existing = this.files.get(path)
        if (!existing) return
        existing.afterContent = afterContent
        if (!existing.toolNames.includes(toolName)) existing.toolNames.push(toolName)
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
}
