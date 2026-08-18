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

import { useState } from 'react'
import { Button, Spin } from 'antd'
import styled from '@emotion/styled'
import { FolderGit2, MessageSquare, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** dry-run 预检结果（hub POST /api/sessions/:id/rewind/dry-run 响应体） */
export type RewindDryRunResult = {
    canRewind: boolean
    canRestoreFiles: boolean
}

export interface RewindConfirmViewProps {
    /** 回退目标消息原文（预览用；null = 无原文不渲染预览卡片） */
    targetText?: string | null
    /** dry-run 结果；null = 预检拉取中（移动 Drawer 内的 loading 态） */
    dryRun: RewindDryRunResult | null
    /** 执行中（POST 受理后等待 SSE rewind-completed 终态） */
    loading: boolean
    /** 确认执行；参数 = 是否恢复文件（降级形态恒为 false） */
    onConfirm: (restoreFiles: boolean) => void
    onCancel: () => void
}

// ── 视觉层（Claude 暖调：米白底 / 暖灰主色 / 暖橙警示，克制极简）──

const Root = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
`

/** 破坏性警示条：暖橙调，提示此操作会移除后续对话 */
const Notice = styled.div`
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--ant-color-warning-bg);
    border: 1px solid var(--ant-color-warning-border);
    color: var(--ant-color-warning-text);
    font-size: 13px;
    line-height: 1.5;
    svg {
        flex-shrink: 0;
        margin-top: 1px;
    }
`

/** 回退目标预览：左竖引用条 + 截断原文，让用户确认「回退到哪里」 */
const TargetCard = styled.div`
    position: relative;
    padding: 12px 14px 12px 18px;
    border-radius: 10px;
    background: var(--ant-color-bg-layout);
    border: 1px solid var(--ant-color-border-secondary);
    &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 12px;
        bottom: 12px;
        width: 3px;
        border-radius: 2px;
        background: var(--ant-color-primary);
    }
`

const TargetLabel = styled.div`
    font-size: 11px;
    color: var(--ant-color-text-tertiary);
    letter-spacing: 0.02em;
    margin-bottom: 6px;
`

const TargetText = styled.div`
    font-size: 13px;
    color: var(--ant-color-text-secondary);
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
`

const Options = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
`

/** 可点选的执行卡片；primary = 主选项（恢复代码，文件回滚更醒目） */
const OptionCardButton = styled.button<{ primary?: boolean }>`
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
    background: ${props => (props.primary ? 'var(--ant-color-primary-bg)' : 'var(--ant-color-bg-elevated)')};
    border: 1px solid ${props => (props.primary ? 'var(--ant-color-primary-border)' : 'var(--ant-color-border)')};

    &:hover:not(:disabled) {
        border-color: var(--ant-color-primary-border-hover);
        background: ${props => (props.primary ? 'var(--ant-color-primary-bg-hover)' : 'var(--ant-color-bg-container)')};
    }
    &:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }
`

const OptionIcon = styled.span<{ primary?: boolean }>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: ${props => (props.primary ? 'var(--ant-color-success-text)' : 'var(--ant-color-text-secondary)')};
    background: ${props => (props.primary ? 'var(--ant-color-success-bg)' : 'var(--ant-color-bg-layout)')};
`

const OptionText = styled.span`
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
`

const OptionTitle = styled.span`
    font-size: 14px;
    font-weight: 500;
    color: var(--ant-color-text);
`

const OptionDesc = styled.span`
    font-size: 12px;
    line-height: 1.5;
    color: var(--ant-color-text-tertiary);
`

interface OptionCardProps {
    primary?: boolean
    icon: React.ReactNode
    title: string
    desc: string
    loading?: boolean
    disabled?: boolean
    onClick: () => void
}

/** 选项执行卡片：title 兼作 aria-label（desc 仅辅助说明，不进可访问名称） */
function OptionCard({ primary, icon, title, desc, loading, disabled, onClick }: OptionCardProps) {
    return (
        <OptionCardButton primary={primary} disabled={disabled} aria-label={title} onClick={onClick}>
            <OptionIcon primary={primary}>
                {loading ? <Spin size="small" /> : icon}
            </OptionIcon>
            <OptionText>
                <OptionTitle>{title}</OptionTitle>
                <OptionDesc>{desc}</OptionDesc>
            </OptionText>
        </OptionCardButton>
    )
}

/**
 * rewind 确认视图（共用组件，spec §5.5）：
 * PC 锚定 Popover（UserMessageFooter）与移动端长按 Drawer（MessageActionsDrawer）两个薄入口共用。
 * 三形态（spec §5.3）：双 true 两选项 / canRestoreFiles false 单选项 + 说明 / canRewind false 不弹窗（入口层拦截）。
 */
export function RewindConfirmView({ targetText, dryRun, loading, onConfirm, onCancel }: RewindConfirmViewProps) {
    const { t } = useTranslation()
    // 已点选的选项（loading 态只给被点击的选项转圈）
    const [chosen, setChosen] = useState<boolean | null>(null)

    if (!dryRun) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                <Spin />
            </div>
        )
    }

    const canRestore = dryRun.canRewind && dryRun.canRestoreFiles
    const handleConfirm = (restoreFiles: boolean) => {
        setChosen(restoreFiles)
        onConfirm(restoreFiles)
    }

    return (
        <Root>
            <Notice>
                <TriangleAlert size={14} />
                <span>{t('chat.rewind.notice')}</span>
            </Notice>

            {targetText ? (
                <TargetCard>
                    <TargetLabel>{t('chat.rewind.targetLabel')}</TargetLabel>
                    <TargetText>{targetText}</TargetText>
                </TargetCard>
            ) : null}

            <Options>
                {canRestore ? (
                    <>
                        <OptionCard
                            primary
                            icon={<FolderGit2 size={17} />}
                            title={t('chat.rewind.restoreAndRewind')}
                            desc={t('chat.rewind.restoreDesc')}
                            loading={loading && chosen === true}
                            disabled={loading}
                            onClick={() => handleConfirm(true)}
                        />
                        <OptionCard
                            icon={<MessageSquare size={17} />}
                            title={t('chat.rewind.rewindOnly')}
                            desc={t('chat.rewind.rewindOnlyDesc')}
                            loading={loading && chosen === false}
                            disabled={loading}
                            onClick={() => handleConfirm(false)}
                        />
                    </>
                ) : (
                    <OptionCard
                        primary
                        icon={<MessageSquare size={17} />}
                        title={t('chat.rewind.rewindOnly')}
                        desc={t('chat.rewind.filesUnavailable')}
                        loading={loading}
                        disabled={loading}
                        onClick={() => handleConfirm(false)}
                    />
                )}
            </Options>

            <Button block type="text" disabled={loading} onClick={onCancel}>
                {t('common.cancel')}
            </Button>
        </Root>
    )
}
