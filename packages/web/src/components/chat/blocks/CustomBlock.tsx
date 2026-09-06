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

import type React from 'react'
import { memo } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { ContentBlock } from '@mobi/shared'
import type { CustomBlock as CustomBlockType } from '@/domain/chat'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { getSessionDisplayName } from '@/core/utils/sessionUtils'

/**
 * 自定义消息渲染器（ADR 0002）：按 block.type 一级分发 + ref.targetType 二级注册表。
 * - text 段直出；ref 渲染为可跳转链接（首期仅 session）
 * - 未注册的 block 类型 / ref.targetType 跳过不渲染（向前兼容，未来在此注册新渲染器）
 */

/** ref.targetType 渲染器注册表（受控开放，ADR 0002）：新增 targetType 只需注册新渲染器 */
const REF_TARGET_RENDERERS: Record<string, React.ComponentType<{ refId: string }>> = {
    session: SessionRefLink,
}

/** ref(session) 渲染器：标题实时取（SSE session-updated/removed 驱动缓存失效），点击跳转该会话 */
function SessionRefLink({ refId }: { refId: string }) {
    const { token } = antTheme.useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { data: session } = useSession(refId)

    // 会话已删 / 取不到标题 → 灰文本不可点（spec §4.3 降级）
    if (!session) {
        return (
            <span style={{ color: token.colorTextQuaternary }}>
                {t('chat.custom.sessionRefMissing')}
            </span>
        )
    }

    return (
        <span
            role="link"
            tabIndex={0}
            style={{
                color: token.colorTextSecondary,
                textDecoration: 'underline',
                textUnderlineOffset: 2,
                cursor: 'pointer',
            }}
            onClick={(e) => {
                e.stopPropagation()
                void navigate({ to: '/sessions/$sessionId', params: { sessionId: refId } })
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    void navigate({ to: '/sessions/$sessionId', params: { sessionId: refId } })
                }
            }}
        >
            {getSessionDisplayName(session)}
        </span>
    )
}

/** 单个 block → 渲染节点；未注册类型返回 null（调用方跳过）。key 由调用方（位置序）提供 */
function renderBlock(block: ContentBlock, key: string): React.ReactNode {
    switch (block.type) {
        case 'text':
            return <span key={key}>{block.text}</span>
        case 'ref': {
            const RefRenderer = REF_TARGET_RENDERERS[block.targetType]
            if (!RefRenderer) return null
            return <RefRenderer key={key} refId={block.id} />
        }
        default:
            // image/document/quote：词汇表已定义但渲染器首期未对 custom 通道开放，跳过
            return null
    }
}

/** 自定义消息渲染（如「fork 自会话 xxx」溯源行）：无边框系统行形态 */
export const CustomBlockView = memo(function CustomBlockView({ block }: { block: CustomBlockType }) {
    const { token } = antTheme.useToken()

    const nodes = block.blocks.map((block: ContentBlock, i) => renderBlock(block, `${i}:${block.type}`))

    return (
        <div style={{ padding: '4px 0', fontSize: 12, color: token.colorTextTertiary }}>
            {nodes}
        </div>
    )
})
