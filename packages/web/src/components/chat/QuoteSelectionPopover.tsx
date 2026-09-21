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
import { Button, theme } from 'antd'
import { MessageSquarePlus } from 'lucide-react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'
import { computeQuoteLayerPlacement } from './quoteLayerPlacement'

/** 浮层宽度：紧凑动作条，不随选区长度变化 */
const POPOVER_WIDTH = 220
/** 翻转阈值：选区顶边高于此值才放上方（动作条矮，阈值比评论浮层小） */
const FLIP_THRESHOLD_PX = 120
/** 估算高度（下缘钳制兜底）：按钮行 + padding */
const ESTIMATED_HEIGHT_PX = 44

const Layer = styled.div`
    position: fixed;
    z-index: 1050;
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${POPOVER_WIDTH}px;
    padding: 6px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border);
    border-radius: 10px;
    box-shadow: var(--ant-box-shadow-secondary);
`

/** 禁用态提示条（超长 / 达上限）：灰字说明原因，不可点击 */
const DisabledHint = styled.span`
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-tertiary);
`

/** 选区浮层的定位与内容形态（三态） */
export type QuoteSelectionPopoverState =
    | { rect: DOMRect; kind: 'add'; quote: PendingQuoteRef }
    | { rect: DOMRect; kind: 'tooLong' }
    | { rect: DOMRect; kind: 'limitReached' }

interface QuoteSelectionPopoverProps {
    state: QuoteSelectionPopoverState
    /** 「添加到对话」确认（仅 add 态触发）；确认后由调用方关闭浮层并清理选区 */
    onAdd: (quote: PendingQuoteRef) => void
    onClose: () => void
}

/**
 * 选区引用浮层（spec「入口」三态薄壳）：可添加 / 超长禁用提示 / 达上限禁用提示。
 * fixed 定位锚定选区几何（viewport 坐标），滚动/点击其它处由调用方关闭——
 * 选区消失不影响已捕获的 quote 数据（点击按钮时选区被清是预期路径）。
 */
export const QuoteSelectionPopover = memo(function QuoteSelectionPopover({
    state,
    onAdd,
    onClose,
}: QuoteSelectionPopoverProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()

    // 定位规则（上翻 + 视口钳制）由 quoteLayerPlacement 单处承载，本组件只声明宽度与阈值
    const { top, left, above } = computeQuoteLayerPlacement(state.rect, POPOVER_WIDTH, FLIP_THRESHOLD_PX, ESTIMATED_HEIGHT_PX)

    return (
        <Layer
            data-quote-layer="popover"
            data-testid="quote-selection-popover"
            data-popover-kind={state.kind}
            style={{ top, left, transform: above ? 'translateY(-100%)' : undefined }}
            onMouseDown={(e) => {
                // 阻止浮层内按下夺焦清选区：确认前选区保持高亮（点击按钮清选区是预期路径）
                e.preventDefault()
            }}
        >
            {state.kind === 'add' ? (
                <Button
                    type="primary"
                    size="small"
                    icon={<MessageSquarePlus size={14} />}
                    data-testid="quote-add-button"
                    onClick={() => {
                        onAdd(state.quote)
                        onClose()
                    }}
                >
                    {t('composer.quoteAdd')}
                </Button>
            ) : (
                <DisabledHint data-testid="quote-disabled-hint">
                    {state.kind === 'tooLong' ? t('composer.quoteTooLong') : t('composer.quoteLimitReached')}
                </DisabledHint>
            )}
            {/* 可见关闭入口：浮层无遮罩，点其它处由调用方关闭，此处给明确退出路径 */}
            <Button
                type="text"
                size="small"
                aria-label={t('common.close')}
                onClick={onClose}
                style={{ marginLeft: 4, color: token.colorTextTertiary }}
            >
                ✕
            </Button>
        </Layer>
    )
})
