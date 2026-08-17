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

import { RollbackOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { CopyButton } from './CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { formatMessageTime } from '@/core/utils/timeFormat'

export interface UserMessageFooterProps {
    /** 消息原文（复制用） */
    text: string
    /** 消息时间戳（footer 常驻最右） */
    createdAt: number
    /** rewind 判据（canRewindMessage 结果）——false 时不渲染 rewind 入口（无禁用态，见 spec §5.1） */
    canRewind: boolean
    /** 点击 rewind 入口（打开确认弹窗） */
    onRewind: () => void
}

/**
 * 用户消息 footer 操作组（spec §5.1）：
 * `[复制] [⏪] ············ 12:34` —— 操作组 hover 显示（复用 msg-copy-btn CSS 模式），
 * 时间戳常驻、最右。不可 rewind 时操作组只剩复制。
 */
export function UserMessageFooter({ text, createdAt, canRewind, onRewind }: UserMessageFooterProps) {
    const { t } = useTranslation()
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="msg-copy-btn">
                <CopyButton text={text} size={14} />
            </span>
            {canRewind && (
                <span className="msg-copy-btn">
                    <IconButton
                        icon={<RollbackOutlined style={{ fontSize: 10 }} />}
                        size={14}
                        aria-label={t('chat.rewind.title')}
                        tooltip={t('chat.rewind.title')}
                        tooltipPlacement="top"
                        onClick={onRewind}
                    />
                </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>{formatMessageTime(createdAt)}</span>
        </div>
    )
}
