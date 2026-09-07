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

import { useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import styled from '@emotion/styled'
import { GitFork, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { truncateRewindPreview } from '@/domain/chat/rewind'

export interface ForkConfirmViewProps {
    /** 分叉目标回复原文（预览用；null = 无原文不渲染预览卡片） */
    targetText?: string | null
    /** 创建中（POST 受理后等待响应） */
    loading: boolean
    onConfirm: () => void
    onCancel: () => void
}

// ── 视觉层（布局对齐 RewindConfirmView：米白底 / 暖灰主色 / 暖橙警示，克制极简）──

const Root = styled.div`
    display: flex;
    flex-direction: column;
    gap: 12px;
`

/** 非破坏性提示条：与 rewind 警示条同形态，但语义是「当前会话保持不变」的中性提示 */
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

/** 分叉目标预览：左竖引用条 + 截断原文，让用户确认「从哪条回复分叉」 */
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

/** 可点选的执行卡片（主选项，fork-session spec §4.2：单一动作） */
const OptionCardButton = styled.button`
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
    background: var(--ant-color-primary-bg);
    border: 1px solid var(--ant-color-primary-border);

    &:hover:not(:disabled) {
        border-color: var(--ant-color-primary-border-hover);
        background: var(--ant-color-primary-bg-hover);
    }
    &:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }
`

const OptionIcon = styled.span`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    color: var(--ant-color-success-text);
    background: var(--ant-color-success-bg);
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

/**
 * fork 确认视图（共用组件，fork-session spec §4.2）：
 * PC 锚定 Popover（AgentMessageFooter）与移动端长按 Drawer（MessageActionsDrawer）两个薄入口共用。
 * 无 dry-run 预检（fork 是 hub 侧纯动作，失败在确认后 toast 归因），
 * 形态恒为：提示条 + 目标预览卡 + 单一创建选项 + 取消。
 */
export function ForkConfirmView({ targetText, loading, onConfirm, onCancel }: ForkConfirmViewProps) {
    const { t } = useTranslation()
    // 已点选确认（loading 态选项转圈；loading 期间整卡禁用防重复提交）
    const [chosen, setChosen] = useState(false)

    // loading 收尾即复位：失败后 Popover/Drawer 关闭重开时组件不卸载，chosen 残留会让
    // 重试首帧直接渲染 Spin 而非 GitFork 图标（视觉跳变）
    useEffect(() => {
        if (!loading) setChosen(false)
    }, [loading])

    return (
        <Root>
            <Notice>
                <TriangleAlert size={14} />
                <span>{t('chat.fork.notice')}</span>
            </Notice>

            {targetText ? (
                <TargetCard>
                    <TargetLabel>{t('chat.fork.targetLabel')}</TargetLabel>
                    {/* 预览只作确认锚点：截前 N 字符 + 省略号（与 rewind 预览同一截断口径） */}
                    <TargetText>{truncateRewindPreview(targetText)}</TargetText>
                </TargetCard>
            ) : null}

            <OptionCardButton
                aria-label={t('chat.fork.create')}
                disabled={loading}
                onClick={() => {
                    setChosen(true)
                    onConfirm()
                }}
            >
                <OptionIcon>
                    {loading && chosen ? <Spin size="small" /> : <GitFork size={17} />}
                </OptionIcon>
                <OptionText>
                    <OptionTitle>{t('chat.fork.create')}</OptionTitle>
                    <OptionDesc>{t('chat.fork.createDesc')}</OptionDesc>
                </OptionText>
            </OptionCardButton>

            <Button block type="text" disabled={loading} onClick={onCancel}>
                {t('common.cancel')}
            </Button>
        </Root>
    )
}
