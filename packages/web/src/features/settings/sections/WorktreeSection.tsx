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
 * 设置页「Worktree 管理」分区（SettingRow 行式形态，票07）：
 * 本机全部 mobi worktree（含孤儿）的可见性与处置出口，列表按需扫描（daemon GET /api/worktrees）。
 * 每个 worktree 一行：名称 + 状态 tag 为 label，元信息（仓库/脏文件/大小/时间/会话）为行下说明，
 * 合回/丢弃收进行内操作区。运行中条目的合回/丢弃禁用。
 */

import { useState } from 'react'
import { Alert, App, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { FolderTree, GitBranch, RefreshCw } from 'lucide-react'
import styled from '@emotion/styled'
import type { WorktreeSummary } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { WorktreeMergeModal } from '@/ui/shared/WorktreeMergeModal'
import { WorktreeStateTag } from '@/ui/shared/WorktreeStateTag'
import { useWorktrees } from '@/core/data/hooks/queries/useWorktrees'
import { useWorktreeActions } from '@/core/data/hooks/mutations/useWorktreeActions'
import { formatRelativeTime } from '@/core/utils/timeFormat'
import { formatFileSize } from '@/core/utils/fileSize'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
`

const Name = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    color: ${p => p.$token.colorText};
    display: inline-flex;
    align-items: center;
    gap: 8px;
`

const MetaLine = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
`

const Meta = styled.span<{ $token: Token }>`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
`

const Mono = styled.span<{ $token: Token }>`
    font-family: ${p => p.$token.fontFamilyCode};
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
`

const RowActions = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
`

const EmptyHint = styled.div<{ $token: Token }>`
    padding: 10px 16px 14px;
    font-size: 12.5px;
    color: ${p => p.$token.colorTextTertiary};
`

/** 设置页 Worktree 管理分区 */
export function WorktreeSection() {
    const { token } = useToken()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { modal, message: messageApi } = App.useApp()
    const { data: worktrees, isLoading, isError, refetch, isFetching } = useWorktrees()
    const { discard, discarding } = useWorktreeActions()
    const [mergeTarget, setMergeTarget] = useState<WorktreeSummary | null>(null)

    const items = worktrees ?? []

    const requestDiscard = (item: WorktreeSummary) => {
        modal.confirm({
            title: t('settings.worktrees.discardConfirmTitle', { name: item.name }),
            content: t('settings.worktrees.discardConfirmContent', { count: item.dirtyFileCount }),
            okText: t('settings.worktrees.discard'),
            okButtonProps: { danger: true },
            cancelText: t('common.cancel'),
            onOk: async () => {
                try {
                    const result = await discard(item.worktreePath)
                    if (result.ok) {
                        messageApi.success(t('settings.worktrees.discarded'))
                        return
                    }
                    messageApi.error(t('settings.worktrees.discardFailed'))
                } catch {
                    // 传输层失败（daemon 不可达等）：给出失败反馈，不让确认框挂着未处理的 rejection
                    messageApi.error(t('settings.worktrees.discardFailed'))
                }
            }
        })
    }

    return (
        <Wrap>
            <SettingGroupCard>
                <SettingRow
                    icon={FolderTree}
                    label={
                        <Name $token={token}>
                            {t('settings.worktrees.title')}
                            <Meta $token={token}>{t('settings.worktrees.count', { count: items.length })}</Meta>
                        </Name>
                    }
                    variant="action"
                    action={
                        <Button
                            variant="ghost"
                            size="sm"
                            loading={isFetching}
                            onClick={() => { void refetch() }}
                        >
                            <RefreshCw size={13} />
                            {t('settings.worktrees.refresh')}
                        </Button>
                    }
                />

                {isError && (
                    <Alert type="warning" showIcon message={t('settings.worktrees.scanFailed')} />
                )}

                {!isError && isLoading && <EmptyHint $token={token}>{t('common.loading')}</EmptyHint>}
                {!isError && !isLoading && items.length === 0 && (
                    <EmptyHint $token={token}>{t('settings.worktrees.empty')}</EmptyHint>
                )}

                {items.map((item) => {
                    const running = item.state === 'running'
                    return (
                        <div key={item.worktreePath} data-testid={`worktree-row-${item.name}`}>
                            <SettingRow
                                label={
                                    <Name $token={token}>
                                        {item.name}
                                        <WorktreeStateTag state={item.state} />
                                    </Name>
                                }
                                description={
                                    <MetaLine>
                                        <Meta $token={token}>
                                            <GitBranch size={11} style={{ verticalAlign: -1, marginInlineEnd: 3 }} />
                                            {item.branch}
                                        </Meta>
                                        <Mono $token={token} title={item.repoRoot}>{item.repoRoot}</Mono>
                                        <Meta $token={token}>{t('settings.worktrees.dirtyFiles', { count: item.dirtyFileCount })}</Meta>
                                        <Meta $token={token}>{formatFileSize(item.sizeBytes)}</Meta>
                                        {item.createdAt !== undefined && (
                                            <Meta $token={token}>{t('settings.worktrees.createdAt', { time: formatRelativeTime(item.createdAt, t) })}</Meta>
                                        )}
                                        {item.lastCommitAt !== undefined && (
                                            <Meta $token={token}>{t('settings.worktrees.lastCommitAt', { time: formatRelativeTime(item.lastCommitAt, t) })}</Meta>
                                        )}
                                        {item.sessionId ? (
                                            <SessionLink
                                                $token={token}
                                                onClick={() => {
                                                    void navigate({ to: '/sessions/$sessionId', params: { sessionId: item.sessionId! } })
                                                }}
                                            >
                                                {t('settings.worktrees.openSession')}
                                            </SessionLink>
                                        ) : (
                                            <Meta $token={token}>{t('settings.worktrees.orphan')}</Meta>
                                        )}
                                    </MetaLine>
                                }
                                variant="action"
                                action={
                                    <RowActions>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={running}
                                            title={running ? t('settings.worktrees.runningHint') : undefined}
                                            onClick={() => setMergeTarget(item)}
                                        >
                                            {t('settings.worktrees.merge')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            danger
                                            size="sm"
                                            disabled={running || discarding}
                                            title={running ? t('settings.worktrees.runningHint') : undefined}
                                            onClick={() => requestDiscard(item)}
                                        >
                                            {t('settings.worktrees.discard')}
                                        </Button>
                                    </RowActions>
                                }
                            />
                        </div>
                    )
                })}
            </SettingGroupCard>

            <WorktreeMergeModal
                open={mergeTarget !== null}
                summary={mergeTarget}
                onClose={() => setMergeTarget(null)}
            />
        </Wrap>
    )
}

const SessionLink = styled.button<{ $token: Token }>`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    font-size: 12px;
    color: ${p => p.$token.colorPrimary};
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
        text-decoration: underline;
    }
`
