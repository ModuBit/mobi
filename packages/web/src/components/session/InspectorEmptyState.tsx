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
import { Folder, Terminal, FileSearch } from 'lucide-react'
import styled from '@emotion/styled'
import { theme as antTheme } from 'antd'

interface InspectorEmptyStateProps {
    /** 点「文件」 */
    onOpenFile: () => void
}

interface ActionItem {
    key: string
    icon: React.ReactNode
    labelKey: string
    disabled?: boolean
    onClick?: () => void
}

/**
 * 空态：居中的卡片行列表（参考 macOS 菜单风格——图标 + 标签，浅灰圆角卡）。
 * 终端/审查 disabled（未支持）。仅「文件」可点。
 */
export function InspectorEmptyState({ onOpenFile }: InspectorEmptyStateProps) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()

    const items: ActionItem[] = [
        { key: 'file', icon: <Folder size={18} />, labelKey: 'session.inspector.openFile', onClick: onOpenFile },
        { key: 'terminal', icon: <Terminal size={18} />, labelKey: 'session.inspector.terminal', disabled: true },
        { key: 'review', icon: <FileSearch size={18} />, labelKey: 'session.inspector.review', disabled: true },
    ]

    return (
        <Wrap>
            <List role="list">
                {items.map((item) => (
                    <Row
                        key={item.key}
                        type="button"
                        disabled={item.disabled}
                        onClick={item.disabled ? undefined : item.onClick}
                        $token={token}
                    >
                        <span className="icon">{item.icon}</span>
                        <span className="label">{t(item.labelKey)}</span>
                    </Row>
                ))}
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
