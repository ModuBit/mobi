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

import { useState, useEffect, useCallback, useRef } from 'react'
import { GitBranch, FolderTree, Folder, ChevronDown } from 'lucide-react'
import styled from '@emotion/styled'
import type { SessionMetadataSummary } from '@/core/data/api/types'

/** 自动收起延迟（毫秒） */
const AUTO_COLLAPSE_DELAY = 3000

const BarContainer = styled.div<{ $expanded: boolean }>`
    display: flex;
    flex-direction: column;
    padding: ${({ $expanded }) => $expanded ? '6px 12px' : '2px 12px'};
    background: var(--ant-color-bg-layout);
    border-bottom: 1px solid var(--ant-color-border-secondary);
    cursor: pointer;
    overflow: hidden;
    user-select: none;
    transition: padding 0.2s ease;
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
        }
    }}
`

const StyledChevron = styled(ChevronDown)<{ $expanded: boolean }>`
    opacity: 0.3;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    transform: rotate(${({ $expanded }) => $expanded ? '180deg' : '0deg'});
`

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
    flex-shrink: 0;
`

interface SessionContextBarProps {
    metadata: SessionMetadataSummary | null
}

/**
 * Session 上下文信息条（吊顶效果）
 *
 * 展示当前 session 的环境上下文：工作目录、Git 分支、Worktree 状态。
 * PC 和移动端行为一致：
 * 1. 进入 session 默认展开，3 秒后自动收起
 * 2. 点击切换展开/收起
 */
export function SessionContextBar({ metadata }: SessionContextBarProps) {
    const [expanded, setExpanded] = useState(true)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const userToggledRef = useRef(false)

    const hasContent = Boolean(metadata && metadata.path)

    const clearCollapseTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
    }, [])

    const startCollapseTimer = useCallback(() => {
        clearCollapseTimer()
        timerRef.current = setTimeout(() => {
            setExpanded(false)
        }, AUTO_COLLAPSE_DELAY)
    }, [clearCollapseTimer])

    // 初始展开，3 秒后收起
    useEffect(() => {
        if (!hasContent) return
        setExpanded(true)
        userToggledRef.current = false
        startCollapseTimer()
        return clearCollapseTimer
    }, [hasContent, startCollapseTimer, clearCollapseTimer])

    const handleClick = useCallback(() => {
        clearCollapseTimer()
        setExpanded(prev => !prev)
        userToggledRef.current = true
    }, [clearCollapseTimer])

    if (!hasContent) return null

    const gitBranch = metadata!.gitBranch
    const worktree = metadata!.worktree
    const path = metadata!.path

    return (
        <BarContainer
            $expanded={expanded}
            role="button"
            aria-label="session-context"
            onClick={handleClick}
        >
            <ContentRow>
                <StyledChevron $expanded={expanded} size={14} />
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
