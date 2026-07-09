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

import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'
import { INSPECTOR_ACTIONS } from './inspectorActions'

interface InspectorEmptyStateProps {
    /** 点「文件」 */
    onOpenFile: () => void
    /** 点「终端」（未传或达上限时该卡片置灰） */
    onOpenTerminal?: () => void
    /** 终端已达上限：terminal 卡片叠加上限 disable（与「+」菜单一致） */
    terminalDisabled?: boolean
}

/**
 * 空态：居中的卡片行列表（参考 macOS 菜单风格——图标 + 标签，浅灰圆角卡）。
 * 动作清单与「+」下拉菜单共用 INSPECTOR_ACTIONS，避免两处能力漂移。
 */
export function InspectorEmptyState({ onOpenFile, onOpenTerminal, terminalDisabled }: InspectorEmptyStateProps) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()

    return (
        <Wrap>
            <List role="list">
                {INSPECTOR_ACTIONS.map((item) => {
                    const { Icon } = item
                    // 终端卡片：达上限时叠加 disable（与「+」菜单一致）
                    const disabled =
                        item.disabled || (item.key === 'terminal' && (terminalDisabled ?? false))
                    // onClick 按 key 分发：terminal → onOpenTerminal，其余 → onOpenFile
                    const onClick = disabled
                        ? undefined
                        : item.key === 'terminal'
                            ? onOpenTerminal
                            : onOpenFile
                    return (
                        <Row
                            key={item.key}
                            type="button"
                            disabled={disabled}
                            onClick={onClick}
                            $token={token}
                        >
                            <span className="icon"><Icon size={18} /></span>
                            <span className="label">{t(item.labelKey)}</span>
                        </Row>
                    )
                })}
            </List>
        </Wrap>
    )
}

const Wrap = styled.div`
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
`

const List = styled.div`
    width: 100%;
    max-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 6px;
`

const Row = styled.button<{ $token: ReturnType<typeof antTheme.useToken>['token'] }>`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border: none;
    border-radius: 8px;
    background: ${(p) => p.$token.colorFillQuaternary};
    color: ${(p) => p.$token.colorText};
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;

    .icon {
        display: inline-flex;
        color: ${(p) => p.$token.colorTextSecondary};
    }

    &:hover:not(:disabled) {
        background: ${(p) => p.$token.colorFillTertiary};
    }

    &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
`
