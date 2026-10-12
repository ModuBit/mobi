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

import { useMemo } from 'react'
import type { ChatBlock, NormalizedMessage } from '@/domain/chat'
import { normalizeDecryptedMessage, reduceChatBlocks } from '@/domain/chat'
import { useSidechainMessages } from '@/core/data/hooks/queries/useSidechainMessages'

/**
 * Agent sidechain 数据获取 hook
 * 封装两条数据路径：
 * - SSE 实时路径：block.children 已有数据（hasChildren=true）
 * - API 历史路径：从 sidechain-messages 接口补载（hasChildren=false）
 */
export function useAgentSidechain(block: Extract<ChatBlock, { kind: 'tool-call' }>, sessionId?: string) {
    const hasChildren = block.children.length > 0

    // 实时会话 children 已有数据，历史会话从 API 补载
    const { data: sidechainMessages = [], isPending } = useSidechainMessages(
        hasChildren ? null : (sessionId ?? null),
        hasChildren ? null : block.tool.id,
    )

    const blocks = useMemo(() => {
        if (hasChildren) return block.children
        if (sidechainMessages.length === 0) return []

        const normalized = sidechainMessages
            .map((msg) => normalizeDecryptedMessage(msg))
            .filter((m): m is NormalizedMessage => m !== null)
            // 去掉 isSidechain 标记，让 traceMessages 将它们视为根消息处理
            .map(m => ({ ...m, isSidechain: false as const }))
        const { blocks: reducedBlocks } = reduceChatBlocks(normalized, null)
        return reducedBlocks
    }, [hasChildren, block.children, sidechainMessages])

    // hasChildren 时 query 被禁用，TanStack Query v5 会返回 isPending=true（无缓存），
    // 但 blocks 已有数据，此时不应视为加载中
    const isLoading = !hasChildren && isPending

    return { blocks, isLoading }
}
