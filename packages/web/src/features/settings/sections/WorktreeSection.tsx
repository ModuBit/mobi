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
 * 设置页「Worktree 管理」分区：本机全部 mobi worktree（含孤儿）的可见性与处置出口。
 * 列表按需扫描（daemon GET /api/worktrees）；运行中条目的合回/丢弃禁用。
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
import { SettingsCard, enter } from '@/features/settings/blocks/shared'

const { useToken } = antTheme
type Token = ReturnType<typeof useToken>['token']

const Wrap = styled.div`
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: ${enter} 0.25s ease-out;
`

const Card = styled(SettingsCard)<{ $token: Token }>`
    padding: 18px ${p => p.$token.padding}px;
    gap: 12px;
`

const HeaderRow = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
`

const Title = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: ${p => p.$token.colorText};
`

const Count = styled.span<{ $token: Token }>`
    font-size: 12px;
    color: ${p => p.$token.colorTextTertiary};
`

const Spacer = styled.span`
    flex: 1;
`

const Row = styled.div<{ $token: Token }>`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-top: 1px solid ${p => p.$token.colorBorderSecondary};

    &:first-of-type {
        border-top: none;
    }
`

const RowTop = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
`

const Name = styled.span<{ $token: Token }>`
    font-weight: 600;
    font-size: 13.5px;
    color: ${p => p.$token.colorText};
`

const Mono = styled.span<{ $token: Token }>`
    font-family: var(--font-mono);
    font-size: 12px;
    color: ${p => p.$token.colorTextSecondary};
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
`

const MetaGrid = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 12px;
    color: var(--ant-color-text-tertiary);
`

const Meta = styled.span`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
`

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

const Actions = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-inline-start: auto;
`

const Empty = styled.div<{ $token: Token }>`
    padding: 20px 0;
    font-size: 13px;
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
            <Card $token={token}>
                <HeaderRow>
                    <FolderTree size={16} opacity={0.75} />
                    <Title $token={token}>{t('settings.worktrees.title')}</Title>
                    <Count $token={token}>{t('settings.worktrees.count', { count: items.length })}</Count>
                    <Spacer />
                    <Button
                        variant="ghost"
                        size="sm"
                        loading={isFetching}
                        onClick={() => { void refetch() }}
                    >
                        <RefreshCw size={13} />
                        {t('settings.worktrees.refresh')}
                    </Button>
                </HeaderRow>

                {isError && (
                    <Alert type="warning" showIcon message={t('settings.worktrees.scanFailed')} />
                )}

                {!isError && isLoading && <Empty $token={token}>{t('common.loading')}</Empty>}
                {!isError && !isLoading && items.length === 0 && (
                    <Empty $token={token}>{t('settings.worktrees.empty')}</Empty>
                )}

                {items.map((item) => {
                    const running = item.state === 'running'
                    return (
                        <Row key={item.worktreePath} $token={token} data-testid={`worktree-row-${item.name}`}>
                            <RowTop>
                                <Name $token={token}>{item.name}</Name>
                                <WorktreeStateTag state={item.state} />
                                <Mono $token={token} title={item.branch}>
                                    <GitBranch size={11} style={{ verticalAlign: -1, marginInlineEnd: 3 }} />
                                    {item.branch}
                                </Mono>
                                <Actions>
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
                                </Actions>
                            </RowTop>
                            <MetaGrid>
                                <Meta title={item.repoRoot}>{item.repoRoot}</Meta>
                                <Meta>{t('settings.worktrees.dirtyFiles', { count: item.dirtyFileCount })}</Meta>
                                <Meta>{formatFileSize(item.sizeBytes)}</Meta>
                                {item.createdAt !== undefined && (
                                    <Meta>{t('settings.worktrees.createdAt', { time: formatRelativeTime(item.createdAt, t) })}</Meta>
                                )}
                                {item.lastCommitAt !== undefined && (
                                    <Meta>{t('settings.worktrees.lastCommitAt', { time: formatRelativeTime(item.lastCommitAt, t) })}</Meta>
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
                                    <Meta>{t('settings.worktrees.orphan')}</Meta>
                                )}
                            </MetaGrid>
                        </Row>
                    )
                })}
            </Card>

            <WorktreeMergeModal
                open={mergeTarget !== null}
                summary={mergeTarget}
                onClose={() => setMergeTarget(null)}
            />
        </Wrap>
    )
}
