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
 * 「合回主仓库」确认 Modal（会话吊顶与设置页共用）：目标分支、策略单选、脏树自动
 * WIP 提交与冲突行为说明；结果反馈覆盖成功（含清理结果）/ 冲突（文件清单）/
 * 拒绝（原因）三态。动作成功与否由 daemon 结果 union 决定，前端不猜。
 */

import { useEffect, useState } from 'react'
import { Alert, Modal, Radio } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { MergeBackFailureReason, MergeBackResult, WorktreeSummary } from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'
import { useWorktreeActions } from '@/core/data/hooks/mutations/useWorktreeActions'
import { WorktreeStateTag } from './WorktreeStateTag'

const REASON_KEY: Record<MergeBackFailureReason, string> = {
    'invalid-worktree': 'settings.worktrees.reason.invalidWorktree',
    'session-running': 'settings.worktrees.reason.sessionRunning',
    'main-dirty': 'settings.worktrees.reason.mainDirty',
    'repo-mismatch': 'settings.worktrees.reason.repoMismatch',
    'detached-head': 'settings.worktrees.reason.detachedHead',
    'merge-failed': 'settings.worktrees.reason.mergeFailed',
    'git-failed': 'settings.worktrees.reason.gitFailed'
}

const FileList = styled.ul`
    margin: 6px 0 0;
    padding-inline-start: 18px;
    max-height: 180px;
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: 12px;
`

const MetaRow = styled.div`
    display: flex;
    gap: 8px;
    font-size: 12.5px;
    color: var(--ant-color-text-secondary);
    margin-bottom: 6px;
    min-width: 0;

    & > span:last-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`

const FieldLabel = styled.div`
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ant-color-text);
    margin: 14px 0 6px;
`

const Hint = styled.p`
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--ant-color-text-tertiary);
`

const StrategyOption = styled.div`
    display: flex;
    flex-direction: column;
    gap: 2px;
`

const StrategyTitle = styled.span`
    font-size: 13px;
    color: var(--ant-color-text);
`

const StrategyDesc = styled.span`
    font-size: 11.5px;
    color: var(--ant-color-text-tertiary);
`

type MergeOutcome =
    | { kind: 'idle' }
    | { kind: 'success'; result: Extract<MergeBackResult, { ok: true }> }
    | { kind: 'conflict'; files: string[] }
    | { kind: 'rejected'; reason: MergeBackFailureReason; files?: string[] }

export interface WorktreeMergeModalProps {
    open: boolean
    /** 列表接口的 worktree 画像；缺省（列表未命中）时不可提交 */
    summary: WorktreeSummary | null
    onClose: () => void
}

export function WorktreeMergeModal({ open, summary, onClose }: WorktreeMergeModalProps) {
    const { t } = useTranslation()
    const { mergeBack, merging } = useWorktreeActions()
    const [strategy, setStrategy] = useState<'no-ff' | 'squash'>('no-ff')
    const [outcome, setOutcome] = useState<MergeOutcome>({ kind: 'idle' })

    // 每次打开重置：策略回默认、上一轮结果不残留
    useEffect(() => {
        if (!open) return
        setStrategy('no-ff')
        setOutcome({ kind: 'idle' })
    }, [open, summary?.worktreePath])

    const submit = async () => {
        if (!summary || summary.state === 'running') return
        const result = await mergeBack({ worktreePath: summary.worktreePath, strategy })
        if (result.ok) {
            setOutcome({ kind: 'success', result })
        } else if (result.conflict) {
            setOutcome({ kind: 'conflict', files: result.files ?? [] })
        } else {
            setOutcome({ kind: 'rejected', reason: result.reason, files: result.files })
        }
    }

    const running = summary?.state === 'running'
    const target = summary?.repoBranch

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={t('settings.worktrees.mergeTitle', { name: summary?.name ?? '' })}
            footer={outcome.kind === 'success'
                ? [
                    <Button key="close" onClick={onClose}>
                        {t('common.close')}
                    </Button>
                ]
                : [
                    <Button key="cancel" onClick={onClose} disabled={merging}>
                        {t('common.cancel')}
                    </Button>,
                    <Button
                        key="merge"
                        variant="primary"
                        loading={merging}
                        disabled={!summary || running}
                        onClick={() => { void submit() }}
                    >
                        {t('settings.worktrees.mergeConfirm')}
                    </Button>
                ]}
        >
            {summary && (
                <>
                    <MetaRow>
                        <span>{t('settings.worktrees.columns.branch')}</span>
                        <span>{summary.branch}</span>
                    </MetaRow>
                    <MetaRow>
                        <span>{t('settings.worktrees.columns.path')}</span>
                        <span title={summary.worktreePath}>{summary.worktreePath}</span>
                    </MetaRow>
                    <MetaRow>
                        <span>{t('settings.worktrees.columns.state')}</span>
                        <WorktreeStateTag state={summary.state} />
                    </MetaRow>
                </>
            )}

            {outcome.kind === 'idle' && (
                <>
                    <FieldLabel>{t('settings.worktrees.targetBranch')}</FieldLabel>
                    <MetaRow>
                        <span>→</span>
                        <span>{target ?? t('settings.worktrees.targetBranchUnknown')}</span>
                    </MetaRow>

                    <FieldLabel>{t('settings.worktrees.strategy')}</FieldLabel>
                    <Radio.Group value={strategy} onChange={(event) => setStrategy(event.target.value)}>
                        <Radio value="no-ff">
                            <StrategyOption>
                                <StrategyTitle>{t('settings.worktrees.strategyNoFf')}</StrategyTitle>
                                <StrategyDesc>{t('settings.worktrees.strategyNoFfDesc')}</StrategyDesc>
                            </StrategyOption>
                        </Radio>
                        <Radio value="squash">
                            <StrategyOption>
                                <StrategyTitle>{t('settings.worktrees.strategySquash')}</StrategyTitle>
                                <StrategyDesc>{t('settings.worktrees.strategySquashDesc')}</StrategyDesc>
                            </StrategyOption>
                        </Radio>
                    </Radio.Group>

                    <Hint>{t('settings.worktrees.wipHint')}</Hint>
                    <Hint>{t('settings.worktrees.conflictHint')}</Hint>
                    {running && <Hint>{t('settings.worktrees.runningHint')}</Hint>}
                    {target === undefined && <Hint>{t('settings.worktrees.detachedHint')}</Hint>}
                </>
            )}

            {outcome.kind === 'success' && (
                <Alert
                    type="success"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={t('settings.worktrees.merged')}
                    description={[
                        outcome.result.worktreeRemoved
                            ? t('settings.worktrees.mergedWorktreeRemoved')
                            : t('settings.worktrees.mergedWorktreeKept'),
                        outcome.result.branchDeleted
                            ? t('settings.worktrees.mergedBranchDeleted', { branch: summary?.branch ?? '' })
                            : t('settings.worktrees.mergedBranchKept', { branch: summary?.branch ?? '' })
                    ].join('；')}
                />
            )}

            {outcome.kind === 'conflict' && (
                <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={t('settings.worktrees.conflictTitle')}
                    description={(
                        <>
                            <div>{t('settings.worktrees.conflictDesc')}</div>
                            <FileList>
                                {outcome.files.map((file) => <li key={file}>{file}</li>)}
                            </FileList>
                        </>
                    )}
                />
            )}

            {outcome.kind === 'rejected' && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={t('settings.worktrees.rejectedTitle')}
                    description={(
                        <>
                            <div>{t(REASON_KEY[outcome.reason])}</div>
                            {outcome.files && outcome.files.length > 0 && (
                                <FileList>
                                    {outcome.files.map((file) => <li key={file}>{file}</li>)}
                                </FileList>
                            )}
                        </>
                    )}
                />
            )}
        </Modal>
    )
}
