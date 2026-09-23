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

import { memo, useLayoutEffect, useRef, useState } from 'react'
import styled from '@emotion/styled'
import { useTranslation } from 'react-i18next'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'
import { computeQuoteLayerPlacement } from './quoteLayerPlacement'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

/** 浮层宽度：内容自适应（max-content），仅以估算值兜底钳制与首帧定位 */
const ESTIMATED_WIDTH = 120
/** 自适应上限：禁用态提示较长时收进此宽内换行不起（nowrap + 椭圆省略由 hint 自理） */
const MAX_LAYER_WIDTH = 280
/** 翻转阈值：选区顶边高于此值才放上方（动作条矮，阈值比评论浮层小） */
const FLIP_THRESHOLD_PX = 120
/** 估算高度（下缘钳制兜底）：单行按钮组 */
const ESTIMATED_HEIGHT_PX = 44

/**
 * 按钮组容器（对齐 ChatGPT 选区菜单形态）：白底胶囊，纯文本动作项以细分隔线相连——
 * 不用实心主按钮、不设独立关闭钮（点浮层外即关，调用方 mousedown-outside 已收口）。
 */
const Layer = styled.div`
    position: fixed;
    z-index: 1050;
    display: flex;
    align-items: stretch;
    width: max-content;
    max-width: ${MAX_LAYER_WIDTH}px;
    padding: 2px;
    background: var(--ant-color-bg-elevated);
    border: 1px solid var(--ant-color-border-secondary);
    border-radius: 10px;
    box-shadow: var(--ant-box-shadow-secondary);
`

/** 按钮组动作项：纯文本 + hover 弱化底（分组的段感由容器与分隔线承载） */
const ActionItem = styled.button`
    flex: 1;
    padding: 7px 10px;
    border: none;
    background: transparent;
    border-radius: 8px;
    font-size: 13px;
    line-height: 20px;
    color: var(--ant-color-text);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;

    &:hover {
        background: var(--ant-color-fill-tertiary);
    }
`

/** 禁用态提示项（超长 / 达上限）：灰字说明原因，占据按钮组槽位但不可点击 */
const DisabledHint = styled.span`
    flex: 1;
    padding: 7px 10px;
    font-size: 13px;
    line-height: 20px;
    color: var(--ant-color-text-tertiary);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`

/** 选区浮层的定位与内容形态（三态）。add 态携带原始 Range——「添加到对话」后
 *  评论期间用它渲染选区 ghost 高亮（原生选区视觉会被输入框夺焦清掉） */
export type QuoteSelectionPopoverState =
    | { rect: DOMRect; kind: 'add'; quote: PendingQuoteRef; range: Range }
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
    // 移动端优先放选区下方：系统文本选择菜单覆盖在选区上方，同侧会被盖住
    const isMobile = useIsMobile()

    // 定位规则（上翻 + 视口钳制）由 quoteLayerPlacement 单处承载。宽度自适应后钳制
    // 需要实测宽：首帧按估算值定位，挂载后测量修正（同帧内完成，无可见跳动）
    const layerRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(ESTIMATED_WIDTH)
    useLayoutEffect(() => {
        if (layerRef.current) setWidth(layerRef.current.offsetWidth)
    }, [state.kind])
    const { top, left, above } = computeQuoteLayerPlacement(
        state.rect,
        width,
        FLIP_THRESHOLD_PX,
        ESTIMATED_HEIGHT_PX,
        isMobile,
    )

    return (
        <Layer
            ref={layerRef}
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
                <ActionItem
                    type="button"
                    data-testid="quote-add-button"
                    onClick={() => {
                        onAdd(state.quote)
                        onClose()
                    }}
                >
                    {t('composer.quoteAdd')}
                </ActionItem>
            ) : (
                <DisabledHint data-testid="quote-disabled-hint">
                    {state.kind === 'tooLong' ? t('composer.quoteTooLong') : t('composer.quoteLimitReached')}
                </DisabledHint>
            )}
        </Layer>
    )
})
