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

import { Undo2 } from 'lucide-react'
import { Popover } from 'antd'
import { useTranslation } from 'react-i18next'
import { CopyButton } from './CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { RewindConfirmView, type RewindDryRunResult } from './RewindConfirmView'
import { formatMessageTime } from '@/core/utils/timeFormat'

export interface UserMessageFooterProps {
    /** 消息原文（复制用） */
    text: string
    /** 消息时间戳（footer 常驻最右） */
    createdAt: number
    /** rewind 判据（canRewindMessage 结果）——false 时不渲染 rewind 入口（无禁用态，见 spec §5.1） */
    canRewind: boolean
    /** 点击 rewind 入口（发起 dry-run，结果到达后由 rewindOpen 打开 Popover） */
    onRewind: () => void
    // ── rewind 锚定 Popover（PC 入口，替代居中 Modal）──
    /** 这条消息是否是被激活的回退目标（Popover 受控 open，由 dry-run 完成后置 true） */
    rewindOpen?: boolean
    /** 回退目标原文（预览用） */
    rewindTargetText?: string | null
    /** dry-run 结果；null = 预检拉取中（Popover 内 loading 态） */
    rewindDryRun?: RewindDryRunResult | null
    /** 执行中（POST 受理后等 SSE 终态） */
    rewindLoading?: boolean
    onRewindConfirm?: (restoreFiles: boolean) => void
    onRewindCancel?: () => void
}

/**
 * 用户消息 footer 操作组（spec §5.1）：
 * `[复制] [⏪] ············ 12:34` —— 操作组 hover 显示（复用 msg-copy-btn CSS 模式），
 * 时间戳常驻、最右。不可 rewind 时操作组只剩复制。
 *
 * rewind 入口（PC）：⏪ 图标外包受控 Popover，锚定确认视图——替代居中 Modal，保持
 * 「回退点」与「确认动作」的空间连续。点击 ⏪ 触发 dry-run（onRewind），预检通过后
 * rewindOpen 置 true 打开 Popover；点击外部或再次点击 ⏪ 触发 onRewindCancel 收起。
 */
export function UserMessageFooter({
    text, createdAt, canRewind, onRewind,
    rewindOpen, rewindTargetText, rewindDryRun, rewindLoading, onRewindConfirm, onRewindCancel,
}: UserMessageFooterProps) {
    const { t } = useTranslation()
    const rewindActive = canRewind && !!rewindOpen

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="msg-copy-btn">
                <CopyButton text={text} size={14} />
            </span>
            {canRewind && (
                <span className="msg-copy-btn">
                    <Popover
                        open={rewindActive}
                        trigger="click"
                        placement="bottomRight"
                        onOpenChange={(next) => {
                            // 受控 Popover：open 由 rewindOpen（dry-run 完成）驱动；
                            // 点击展开交给 child onClick（触发 dry-run），这里只处理关闭。
                            if (!next) onRewindCancel?.()
                        }}
                        content={
                            <div style={{ width: 320 }}>
                                <RewindConfirmView
                                    targetText={rewindTargetText ?? null}
                                    dryRun={rewindDryRun ?? null}
                                    loading={rewindLoading ?? false}
                                    onConfirm={(restoreFiles) => onRewindConfirm?.(restoreFiles)}
                                    onCancel={() => onRewindCancel?.()}
                                />
                            </div>
                        }
                    >
                        <IconButton
                            icon={<Undo2 size={14} />}
                            size={14}
                            aria-label={t('chat.rewind.title')}
                            tooltip={rewindActive ? undefined : t('chat.rewind.title')}
                            tooltipPlacement="top"
                            active={rewindActive}
                            onClick={rewindActive ? undefined : onRewind}
                        />
                    </Popover>
                </span>
            )}
            <span style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: 11, opacity: 0.6 }}>{formatMessageTime(createdAt)}</span>
        </div>
    )
}
