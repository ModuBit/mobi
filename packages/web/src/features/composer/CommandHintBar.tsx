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

const HintWrapper = styled.div<{ $visible: boolean }>`
    overflow: hidden;
    max-height: ${({ $visible }) => ($visible ? '60px' : '0')};
    opacity: ${({ $visible }) => ($visible ? 1 : 0)};
    padding-top: ${({ $visible }) => ($visible ? '6px' : '0')};
    padding-bottom: ${({ $visible }) => ($visible ? '6px' : '0')};
    transition: max-height 0.2s ease, opacity 0.2s ease, padding 0.2s ease;
`

interface CommandHintBarProps {
    /** 是否可见 */
    visible: boolean
    /** 参数提示文本（如 <message>） */
    hint?: string
    /** 命令描述 */
    description?: string
}

/**
 * Slash Command 参数提示条
 * 在 Sender header 区域展示选中命令的参数提示和描述
 * 始终挂载，通过 visible 控制展开/收起动画
 */
export function CommandHintBar({ visible, hint, description }: CommandHintBarProps) {
    const { token } = theme.useToken()

    return (
        <HintWrapper $visible={visible} style={{
            paddingLeft: 16,
            paddingRight: 16,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
        }}>
            {hint && (
                <span style={{
                    color: token.colorTextSecondary,
                    fontFamily: 'monospace',
                }}>
                    {hint}
                </span>
            )}
            {description && (
                <span style={{ color: token.colorTextTertiary }}>
                    {description}
                </span>
            )}
        </HintWrapper>
    )
}
