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

import type { Database } from 'bun:sqlite'

import { isObject, refBlockToActionText, type ContentBlock } from '@mobi/shared'

import { safeJsonParse } from './json'
import { resolveSessionTitle } from './sessionFork'

/**
 * ADR 0003 存量迁移：ref block 溯源消息 → mobi URI 动作链接文本。
 *
 * ref block 已从词汇表退场，fork 特性交付当日的历史溯源消息（`text + ref(session)` 组合）
 * 在启动时惰性改写为单个 text block `fork 自会话 [〈标题〉](mobi://session/open?id=…)`。
 * 幂等判据：改写后行不再含 `"type":"ref"`，二次启动被 LIKE 条件自然跳过。
 *
 * 范围守卫：只动 `role === 'custom'` 且 content 为 block 数组的信封（ref 的唯一生产者）——
 * agent 消息是 CC 原始结构透传，tool 输出文本里碰巧含 `"type":"ref"` 字面量的行不受影响。
 * LIKE 全量扫描仅启动时一次，量级可接受；存量行归零后等价于空扫描。
 */

/** 迁移结果（观测用，hub 启动日志可打点） */
export interface LegacyRefMigrationResult {
    /** LIKE 命中的行数 */
    scanned: number
    /** 实际改写的行数 */
    rewritten: number
}

export function migrateLegacyRefMessages(db: Database): LegacyRefMigrationResult {
    const rows = db.prepare(
        `SELECT id, content FROM messages WHERE content LIKE '%"type":"ref"%'`
    ).all() as Array<{ id: string; content: string }>

    // 标题解析：会话行存在走 resolveSessionTitle（name → path 基名 → id 前缀），
    // 行不存在（parent 已删）冻结降级文案
    const titleResolver = (sessionId: string): string => {
        const row = db.prepare('SELECT metadata FROM sessions WHERE id = ?').get(sessionId) as { metadata: string | null } | null
        if (!row) return '已删除的会话'
        return resolveSessionTitle(safeJsonParse(row.metadata), sessionId)
    }

    let rewritten = 0
    const update = db.prepare('UPDATE messages SET content = ? WHERE id = ?')
    const run = db.transaction(() => {
        for (const row of rows) {
            const rewrittenContent = rewriteCustomRefBlocks(safeJsonParse(row.content), titleResolver)
            if (rewrittenContent === null) continue
            update.run(JSON.stringify(rewrittenContent), row.id)
            rewritten += 1
        }
    })
    run()
    return { scanned: rows.length, rewritten }
}

/**
 * 改写单个 custom 信封内的 ref block：ref(session) 转动作链接文本并与相邻前缀 text 合并。
 * 非 custom 信封 / content 非数组 / 不含 ref → 返回 null（不改写）；
 * 未注册 targetType 的 ref（理论不可达，防御）返回 null 整块丢弃——归一层本就会剔除。
 */
function rewriteCustomRefBlocks(
    content: unknown,
    titleResolver: (sessionId: string) => string,
): unknown {
    if (!isObject(content) || content.role !== 'custom' || !Array.isArray(content.content)) return null
    // 以 unknown 层面遍历：'ref' 已不在 ContentBlock 词汇里，按判别联合收窄会把 ref 分支推成 never
    const blocks = content.content as unknown[]
    const refBlocks = blocks.filter((block) => isObject(block) && block.type === 'ref')
    if (refBlocks.length === 0) return null
    // 保守跳过（ticket 02 裁决）：含未注册 targetType 的行整行不改写——保留原始数据，
    // 未来注册新资源域时可再迁移；只丢 ref 块会不可逆销毁 id
    if (refBlocks.some((block) => (block as Record<string, unknown>).targetType !== 'session')) return null

    const out: ContentBlock[] = []
    for (const item of blocks) {
        if (!isObject(item)) { out.push(item as ContentBlock); continue }
        if (item.type !== 'ref') { out.push(item as ContentBlock); continue }

        const linkText = refBlockToActionText(
            { targetType: String(item.targetType), id: String(item.id) },
            titleResolver(String(item.id)),
        )
        // 行级守卫已保证 targetType === 'session'，null 分支仅防御（保持类型完备）
        if (linkText === null) continue

        const prev = out[out.length - 1]
        if (prev?.type === 'text') {
            out[out.length - 1] = { type: 'text', text: prev.text + linkText }
        } else {
            out.push({ type: 'text', text: linkText })
        }
    }
    return { ...content, content: out }
}
