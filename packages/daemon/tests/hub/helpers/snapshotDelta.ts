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

import { locateSnapshotBlocks, type SnapshotBlock } from '@mobi/shared'

/**
 * snapshot delta 测试共用 helper：信封构造与 blocks 提取的单一实现，
 * 导航逻辑直接复用生产 locateSnapshotBlocks（防测试与实现漂移）。
 */

/** 构造与 CLI 真实发送一致的 content 信封：{role, content:{type:'output', data: rawLog}} */
export function envelope(blocks: SnapshotBlock[]): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { role: 'assistant', id: 'msg_1', content: blocks, model: 'm-1' },
            },
        },
        meta: { sentFrom: 'cli' },
    }
}

/** 单文本块信封便捷形（多数用例只需一段流式文本） */
export function textEnvelope(text: string): unknown {
    return envelope([{ type: 'text', text }])
}

/** 从信封取 blocks（断言用）；不可导航即抛——信封形状漂移应让测试显式失败 */
export function blocksOf(content: unknown): SnapshotBlock[] {
    const blocks = locateSnapshotBlocks(content)
    if (blocks === null) throw new Error('信封不可导航：locateSnapshotBlocks 返回 null')
    return blocks
}
