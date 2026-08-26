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

import { GitBranch, FolderTree, Folder } from 'lucide-react'
import styled from '@emotion/styled'
import type { SessionMetadataSummary } from '@/core/data/api/types'

/** Session 上下文信息条（吊顶）：工作目录 / Git 分支 / Worktree，静态展示。
 * 上下文用量已移至水位圆环（ContextRing）展示，吊顶不再承载用量。 */
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

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
    flex-shrink: 0;
`

interface SessionContextBarProps {
    metadata: SessionMetadataSummary | null
}

/**
 * Session 上下文信息条（吊顶效果）：工作目录 / Git 分支 / Worktree 状态。
 * 纯静态展示条（上下文用量已移至 composer）。
 */
export function SessionContextBar({ metadata }: SessionContextBarProps) {
    const hasContent = Boolean(metadata && metadata.path)
    if (!hasContent) return null

    const gitBranch = metadata!.gitBranch
    const worktree = metadata!.worktree
    const path = metadata!.path

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
                        <InfoItem $variant="worktree">
                            <FolderTree size={12} />
                            {worktree.name}
                        </InfoItem>
                    </>
                )}
            </ContentRow>
        </BarContainer>
    )
}
