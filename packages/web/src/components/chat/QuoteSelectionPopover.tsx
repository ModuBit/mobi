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

/** 浮层与选区的间距（px）：上方放置时浮层底边距选区顶边，下方放置时对称 */
const POPOVER_GAP = 8
/** 浮层宽度：紧凑动作条，不随选区长度变化 */
const POPOVER_WIDTH = 220
/** 距视口左右边缘的最小间距（fixed 定位无滚动兜底，窄屏必须钳制） */
const VIEWPORT_MARGIN = 8

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

    // 默认在选区上方（底边贴选区顶边）；选区太靠顶时翻到下方（不做逐边翻转的兜底）。
    // 选区中心优先，越出视口边缘时钳回（移动端窄屏/选区贴近边缘的兜底）
    const above = state.rect.top > 120
    const top = above ? state.rect.top - POPOVER_GAP : state.rect.bottom + POPOVER_GAP
    const left = Math.min(
        Math.max(state.rect.left + state.rect.width / 2 - POPOVER_WIDTH / 2, VIEWPORT_MARGIN),
        Math.max(window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
    )

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
