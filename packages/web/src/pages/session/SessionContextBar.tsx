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

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, FolderTree, Folder } from 'lucide-react'
import styled from '@emotion/styled'
import type { WorktreeSummary } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { useWorktrees } from '@/core/data/hooks/queries/useWorktrees'
import { Button } from '@/ui/base/interactive/button/Button'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import { WorktreeMergeModal } from '@/ui/shared/worktree/WorktreeMergeModal'
import { WorktreeStateTag } from '@/ui/shared/worktree/WorktreeStateTag'

/** Session 上下文信息条（吊顶）：工作目录 / Git 分支 / Worktree。
 * 上下文用量已移至水位圆环（ContextRing）展示，吊顶不再承载用量。
 * Worktree 徽标可点开合回入口（信息 + 合回主仓库）。 */
const BarContainer = styled.div`
    display: flex;
    padding: 4px 12px;
    background: var(--ant-color-bg-container);
    border-bottom: 1px solid var(--ant-color-border-secondary);
    user-select: none;
`

const ContentRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 11px;
    color: var(--ant-color-text-tertiary);
`

const InfoItem = styled.span<{ $variant: 'path' | 'branch' | 'worktree' }>`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    min-width: 0;

    ${({ $variant }) => {
        switch ($variant) {
            case 'path':
                return `
                    color: var(--ant-color-text-secondary);
                    font-family: var(--ant-font-family-code);
                `
            case 'branch':
                return `color: var(--ant-color-success);`
            case 'worktree':
                return `color: var(--ant-color-warning-text);`
            default:
                return ''
        }
    }}
`

/** worktree 徽标按钮：视觉继承 InfoItem（worktree 档），点击打开信息/合回弹层 */
const WorktreeTrigger = styled.button`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 1px 6px;
    margin: -1px -6px;
    border: none;
    border-radius: var(--radius-control-sm);
    background: transparent;
    color: var(--ant-color-warning-text);
    font-size: 11px;
    cursor: pointer;

    &:hover {
        background: var(--ant-color-fill-quaternary);
    }
    &:focus-visible {
        outline: 2px solid var(--ant-color-primary);
        outline-offset: 1px;
    }
`

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
    flex-shrink: 0;
`

const Panel = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(320px, calc(100vw - 32px));
    font-size: 12px;
`

const PanelTitle = styled.div`
    font-weight: 600;
    font-size: 12.5px;
    color: var(--ant-color-text);
`

const PanelRow = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    & > span:first-child {
        flex: none;
        width: 64px;
        color: var(--ant-color-text-tertiary);
    }
    & > span:last-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--ant-font-family-code);
        color: var(--ant-color-text-secondary);
    }
`

const ActionRow = styled.div`
    display: flex;
    justify-content: flex-end;
    padding-top: 2px;
`

const PanelHint = styled.div`
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--ant-color-text-tertiary);
`

interface SessionContextBarProps {
    metadata: SessionMetadataSummary | null
}

/**
 * Session 上下文信息条（吊顶效果）：工作目录 / Git 分支 / Worktree 状态。
 * worktree 徽标点击 → 工作树信息 + 「合回主仓库」入口（运行中/列表未命中时禁用）。
 */
export function SessionContextBar({ metadata }: SessionContextBarProps) {
    const { t } = useTranslation()
    const worktree = metadata?.worktree
    const { data: worktrees } = useWorktrees({ enabled: Boolean(worktree) })
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [mergeOpen, setMergeOpen] = useState(false)

    // 会话元数据里的 worktreePath 与列表扫描结果对齐（路径归一差异时按 name+branch 兜底）
    const summary: WorktreeSummary | null = useMemo(() => {
        if (!worktree || !worktrees) return null
        return worktrees.find((item) => item.worktreePath === worktree.worktreePath)
            ?? worktrees.find((item) => item.name === worktree.name && item.branch === worktree.branch)
            ?? null
    }, [worktree, worktrees])

    const hasContent = Boolean(metadata && metadata.path)
    if (!hasContent) return null

    const gitBranch = metadata!.gitBranch
    const path = metadata!.path
    const running = summary?.state === 'running'
    const mergeDisabled = !summary || running

    return (
        <BarContainer role="status" aria-label="session-context" data-testid="session-context-bar">
            <ContentRow>
                {path && (
                    <InfoItem $variant="path">
                        <Folder size={12} />
                        {path}
                    </InfoItem>
                )}
                {gitBranch && (
                    <>
                        <Separator>·</Separator>
                        <InfoItem $variant="branch">
                            <GitBranch size={12} />
                            {gitBranch}
                        </InfoItem>
                    </>
                )}
                {worktree && (
                    <>
                        <Separator>·</Separator>
                        <Popover
                            trigger="click"
                            open={popoverOpen}
                            onOpenChange={setPopoverOpen}
                            side="bottom"
                            align="start"
                            content={(
                                <Panel>
                                    <PanelTitle>{t('session.worktree.title', { name: worktree.name })}</PanelTitle>
                                    <PanelRow>
                                        <span>{t('settings.worktrees.columns.branch')}</span>
                                        <span>{worktree.branch}</span>
                                    </PanelRow>
                                    <PanelRow>
                                        <span>{t('settings.worktrees.columns.path')}</span>
                                        <span title={worktree.worktreePath}>{worktree.worktreePath ?? worktree.name}</span>
                                    </PanelRow>
                                    <PanelRow>
                                        <span>{t('settings.worktrees.columns.state')}</span>
                                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                            {summary ? <WorktreeStateTag state={summary.state} /> : null}
                                            <span>{t('settings.worktrees.dirtyFiles', { count: summary?.dirtyFileCount ?? 0 })}</span>
                                        </span>
                                    </PanelRow>
                                    {running && <PanelHint>{t('session.worktree.runningHint')}</PanelHint>}
                                    {!summary && !running && <PanelHint>{t('session.worktree.unavailableHint')}</PanelHint>}
                                    <ActionRow>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            disabled={mergeDisabled}
                                            onClick={() => {
                                                setPopoverOpen(false)
                                                setMergeOpen(true)
                                            }}
                                        >
                                            {t('session.worktree.mergeBack')}
                                        </Button>
                                    </ActionRow>
                                </Panel>
                            )}
                        >
                            <WorktreeTrigger
                                type="button"
                                aria-label={t('session.worktree.openAria', { name: worktree.name })}
                                data-testid="worktree-badge"
                            >
                                <FolderTree size={12} />
                                {worktree.name}
                            </WorktreeTrigger>
                        </Popover>
                    </>
                )}
            </ContentRow>
            <WorktreeMergeModal
                open={mergeOpen}
                summary={summary}
                onClose={() => setMergeOpen(false)}
            />
        </BarContainer>
    )
}
