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

import type { UserContentBlock } from '@mobi/shared'

/** 非 text block 的占位标签（i18n 文案由调用方注入，本模块保持纯函数） */
export interface SummaryLabels { file: string; image: string; quote: string }

/** 全空标签：非 text block 贡献空串（rewind 回填等不希望占位符进入正文的场景） */
export const EMPTY_SUMMARY_LABELS: SummaryLabels = { file: '', image: '', quote: '' }

/**
 * 单行预览：text 取原文依次连接，非 text block 以标签占位，block 顺序保持。
 * 占位标签之间（以及标签与后续内容之间）插入单个空格——中文文案黏连尚可读，
 * 英文 "[File][Image]" 会不可读。排队消息悬浮条与 rewind 确认视图共用——原
 * QueuedMessagesBar.previewText 与 collectRewindBatchText 的「同形约定」由本函数收口为单一来源。
 */
export function summarizeBlocks(blocks: UserContentBlock[], labels: SummaryLabels): string {
    let out = ''
    let prevWasLabel = false
    for (const b of blocks) {
        if (b.type === 'text') {
            // 标签后接正文补单个空格，与标签间隔规则对称
            if (prevWasLabel && b.text) out += ' '
            out += b.text
            prevWasLabel = false
            continue
        }
        const label =
            b.type === 'document' ? labels.file :
            b.type === 'image' ? labels.image :
            labels.quote
        // 标签与相邻内容之间补单个空格（中文黏连尚可读，英文 "[File][Image]" 不可读）；
        // 空标签（rewind 回填的 EMPTY_SUMMARY_LABELS）不输出、不引入空格
        if (label && (out.length > 0 || prevWasLabel)) out += ' '
        out += label
        prevWasLabel = Boolean(label)
    }
    return out
}

/** rewind 合并批原文收集：批内各行摘要 join('\n')；全空返回 null */
export function joinSummaries(summaries: Array<string | null>): string | null {
    const parts = summaries.filter((s): s is string => !!s && s.length > 0)
    return parts.length > 0 ? parts.join('\n') : null
}
