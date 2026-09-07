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

import { GitFork } from 'lucide-react'
import { Popover } from 'antd'
import { useTranslation } from 'react-i18next'
import { CopyButton } from './CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { ForkConfirmView } from './ForkConfirmView'

export interface AgentTurnActionsProps {
    /** 消息原文（复制用） */
    text: string
    /** 点击 fork 入口（父组件置 forkDraft 打开 Popover） */
    onFork: () => void
    // ── fork 锚定 Popover（PC 入口，与 UserMessageFooter rewind 同模式）──
    /** 这条消息是否是被激活的分叉目标（Popover 受控 open，由 forkDraft 命中本条置 true） */
    forkOpen?: boolean
    /** 分叉目标原文（预览用） */
    forkTargetText?: string | null
    /** 创建中（POST 在途） */
    forkLoading?: boolean
    onForkConfirm?: () => void
    onForkCancel?: () => void
}

/**
 * agent turn 操作组（原 AgentMessageFooter，时间以 turn-result meta 行为唯一来源后
 * 不再自带时间戳）：`[复制] [⑂]` 挂到 turn-result 概要行尾（position A），
 * 仅挂在「turn 的 result 落点」对应的概要行且 canForkMessage 通过时渲染，
 * hover 才显示（.turn-result-bubble .msg-copy-btn CSS 模式，移动端不渲染——
 * 长按 Drawer 是移动端唯一 fork/复制入口）。
 *
 * fork 入口（PC）：⑂ 图标外包受控 Popover 锚定确认视图——与 rewind 的 ⏪ Popover 同构。
 * 点击 ⑂ 触发 onFork（父组件记 forkDraft），forkOpen 置 true 打开；点击外部或取消收起。
 */
export function AgentTurnActions({
    text, onFork,
    forkOpen, forkTargetText, forkLoading, onForkConfirm, onForkCancel,
}: AgentTurnActionsProps) {
    const { t } = useTranslation()
    const forkActive = !!forkOpen

    return (
        // paddingLeft 与概要文字保持呼吸间距（actions 贴 flex 行尾，无它则紧贴时间戳）
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, paddingLeft: 12 }}>
            <span className="msg-copy-btn">
                <CopyButton text={text} size={14} />
            </span>
            <span className="msg-copy-btn">
                <Popover
                    open={forkActive}
                    trigger="click"
                    placement="bottomRight"
                    onOpenChange={(next) => {
                        // 受控 Popover：open 由 forkOpen（forkDraft 命中）驱动；
                        // 点击展开交给 child onClick（记 forkDraft），这里只处理关闭。
                        if (!next) onForkCancel?.()
                    }}
                    content={
                        <div style={{ width: 320 }}>
                            <ForkConfirmView
                                targetText={forkTargetText ?? null}
                                loading={forkLoading ?? false}
                                onConfirm={() => onForkConfirm?.()}
                                onCancel={() => onForkCancel?.()}
                            />
                        </div>
                    }
                >
                    <IconButton
                        icon={<GitFork size={14} />}
                        size={14}
                        aria-label={t('chat.fork.title')}
                        tooltip={forkActive ? undefined : t('chat.fork.title')}
                        tooltipPlacement="top"
                        active={forkActive}
                        onClick={forkActive ? undefined : onFork}
                    />
                </Popover>
            </span>
        </span>
    )
}
