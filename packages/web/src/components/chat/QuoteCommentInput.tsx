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

import { memo } from 'react'
import styled from '@emotion/styled'
import { QUOTE_COMMENT_MAX } from '@mobi/shared'
import { computeQuoteLayerPlacement } from './quoteLayerPlacement'
import { CommentField } from '@/components/ui/CommentField'
import { useKeyboardInset } from './useKeyboardInset'

/** 浮层宽度：多行评论输入条 */
const POPOVER_WIDTH = 280
/** 翻转阈值：选区顶边高于此值才放上方（评论浮层高，阈值比动作条大） */
const FLIP_THRESHOLD_PX = 140
/** 估算高度（下缘钳制兜底）：单行输入条 + meta 行 + 浮层 padding */
const ESTIMATED_HEIGHT_PX = 76

const Layer = styled.div`
    position: fixed;
    z-index: 1050;
    width: ${POPOVER_WIDTH}px;
    padding: 4px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border);
    border-radius: 10px;
    box-shadow: var(--ant-box-shadow-secondary);
`

interface QuoteCommentInputProps {
    /** 续编辑回填：同片段重复添加时带出已有评论（首添加为空） */
    initialComment?: string
    rect: DOMRect
    /** 保存：trim 后空串以 undefined 上报（= 无评论引用） */
    onSave: (comment: string | undefined) => void
    /** 关闭（× / Esc / 点浮层外，选区保留） */
    onClose: () => void
}

/**
 * 引用评论输入浮层（spec「评论流」）：引用已在 composer（「添加到对话」即落条目），
 * 此浮层只负责补充评论。编辑器形态（多行自适应 + 字数上限 + ×/✓ 动作）由共享的
 * {@link CommentField} 收口（与 composer 引用列表卡行内编辑同族）；本组件只承担
 * fixed 定位（锚定选区几何 + 视口钳制，规则在 quoteLayerPlacement）与浮层壳。
 * 关闭路径：× / Esc / 点浮层外（选区保留，见 ChatContainer handleQuoteCommentClose）。
 */
export const QuoteCommentInput = memo(function QuoteCommentInput({
    initialComment,
    rect,
    onSave,
    onClose,
}: QuoteCommentInputProps) {
    // 定位规则（上翻 + 视口钳制）由 quoteLayerPlacement 单处承载，本组件只声明宽度与阈值。
    // 键盘弹出（inset > 0）时改挂键盘上缘、全宽减边距：虚拟键盘压缩视口后原选区几何失效，
    // 浮层继续锚选区会脱离视线/被键盘遮挡（2026-09-23 真机：ghost 糊在 composer 上）
    const { top, left, above } = computeQuoteLayerPlacement(rect, POPOVER_WIDTH, FLIP_THRESHOLD_PX, ESTIMATED_HEIGHT_PX)
    const kbInset = useKeyboardInset()

    return (
        <Layer
            data-quote-layer="comment"
            data-testid="quote-comment-layer"
            style={
                kbInset > 0
                    ? { bottom: kbInset + 8, left: 16, right: 16, width: 'auto', transform: undefined }
                    : { top, left, transform: above ? 'translateY(-100%)' : undefined }
            }
        >
            <CommentField
                initialComment={initialComment}
                maxLength={QUOTE_COMMENT_MAX}
                autoFocus
                onSave={onSave}
                onClose={onClose}
                placeholder='添加可选评论...'
            />
        </Layer>
    )
})
