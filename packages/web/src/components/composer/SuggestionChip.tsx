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

import styled from '@emotion/styled'
import { theme } from 'antd'
import type { GlobalToken } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

// 颜色全部走 antd token（colorInfo 族），由主题算法在亮/暗模式下自动适配；
// 不再硬编码蓝色，避免暗色主题下与全局暖灰主色冲突。
const ChipWrapper = styled.div<{ $token: GlobalToken }>`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px 2px 8px;
    font-size: 12px;
    color: ${({ $token }) => $token.colorInfoText};
    background: ${({ $token }) => $token.colorInfoBg};
    border: 1px solid ${({ $token }) => $token.colorInfoBorder};
    border-radius: 12px;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    transition: background 0.2s;
    &:hover {
        background: ${({ $token }) => $token.colorInfoBgHover};
    }
`

const Spark = styled.span`
    font-size: 11px;
    opacity: 0.7;
    flex-shrink: 0;
`

const Text = styled.span`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const DismissButton = styled.button<{ $token: GlobalToken }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: ${({ $token }) => $token.colorInfoText};
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    &:hover {
        background: ${({ $token }) => $token.colorInfoBorder};
    }
`

interface SuggestionChipProps {
    text: string
    onAccept: () => void
    onDismiss: () => void
}

/**
 * 下一轮建议 chip, 显示在 Sender header 中。
 * 点击文本 → 回填草稿(onAccept); 点击 ✕ → 关闭(onDismiss)。
 * 纯受控组件, 生命周期由父级(ChatComposer)通过 store 管理。
 */
export function SuggestionChip({ text, onAccept, onDismiss }: SuggestionChipProps) {
    const { token } = theme.useToken()

    return (
        <ChipWrapper $token={token} onClick={onAccept}>
            <Spark>✦</Spark>
            <Text>{text}</Text>
            <DismissButton
                $token={token}
                aria-label="suggestion-dismiss"
                onClick={(e) => {
                    e.stopPropagation()
                    onDismiss()
                }}
            >
                <CloseOutlined style={{ fontSize: 9, color: token.colorTextSecondary }} />
            </DismissButton>
        </ChipWrapper>
    )
}
