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
 * 引用列表卡的共享视觉词汇（/simplify 收口）：composer 引用胶囊（QuoteChipBar，可编辑）
 * 与气泡 header 引用 chip（UserBubbleHeader，只读）是同一「引用条目」规则的两个宿主——
 * 胶囊、列表卡、编号/excerpt/评论的排版在此单点定义，宿主只保留各自差异（编辑/删除动作、
 * 条目截断策略），改视觉不再需要双处同步。
 */

import styled from '@emotion/styled'

/** 列表卡单条目 excerpt 预览截断宽度（全文语义由定位跳转承载） */
export const QUOTE_ITEM_PREVIEW_MAX = 120

/** 胶囊按钮（composer 与气泡 header 同款；count 与 Quote icon 由宿主传入文案组成） */
export const QuoteChip = styled.button`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--ant-color-border-secondary);
    background: var(--ant-color-bg-container);
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;

    &:hover {
        border-color: var(--ant-color-border);
        color: var(--ant-color-text);
    }
`

/** 列表卡容器：恒定宽度（窄屏由 quote-list-popover 锁死几何接管，styles/antd.css）；
 *  条间分隔用 gap + :not(:last-child) border-bottom（统一节奏） */
export const QuoteListBox = styled.div`
    width: min(420px, calc(100vw - 48px));

    @media (max-width: 640px) {
        width: 100%;
    }

    max-height: min(320px, 60dvh);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
`

export const QuoteItemIndex = styled.span`
    flex-shrink: 0;
    min-width: 18px;
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-tertiary);
    font-variant-numeric: tabular-nums;
`

export const QuoteItemBody = styled.div`
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
`

export const QuoteItemText = styled.span`
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-secondary);
    word-break: break-word;
    white-space: pre-wrap;
`

/** 评论行：与所选文本区分的更弱色调（评论是用户的话，附在引用内容之下） */
export const QuoteItemComment = styled.span`
    font-size: 12px;
    line-height: 18px;
    color: var(--ant-color-text-tertiary);
    word-break: break-word;
    white-space: pre-wrap;
`

export const QuoteItemAction = styled.span`
    flex-shrink: 0;
    font-size: 10px;
    color: var(--ant-color-text-quaternary);
    cursor: pointer;
    transition: color 0.15s;
    &:hover {
        color: var(--ant-color-text-secondary);
    }
`
