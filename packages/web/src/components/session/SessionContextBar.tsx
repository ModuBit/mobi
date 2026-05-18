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
import { GitBranch, FolderTree } from 'lucide-react'
import styled from '@emotion/styled'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'

/** 自动收起延迟（毫秒） */
const AUTO_COLLAPSE_DELAY = 3000

const BarContainer = styled.div<{ $expanded: boolean }>`
    display: flex;
    flex-direction: column;
    padding: ${({ $expanded }) => $expanded ? '6px 12px' : '2px 12px'};
    background: rgba(99, 102, 241, 0.04);
    border-bottom: 1px solid var(--ant-color-border);
    cursor: pointer;
    overflow: hidden;
    user-select: none;
    transition: padding 0.3s ease;
`

const SummaryRow = styled.div`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
`

const DetailRow = styled.div<{ $visible: boolean }>`
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: ${({ $visible }) => $visible ? '4px' : '0'};
    max-height: ${({ $visible }) => $visible ? '40px' : '0'};
    opacity: ${({ $visible }) => $visible ? 1 : 0};
    overflow: hidden;
    transition: all 0.3s ease;
`

const Tag = styled.span<{ $variant: 'path' | 'branch' | 'worktree' }>`
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    flex-shrink: 0;

    ${({ $variant }) => {
        switch ($variant) {
            case 'path':
                return `
                    color: #6366f1;
                    background: rgba(99, 102, 241, 0.1);
                    font-family: monospace;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 200px;
                `
            case 'branch':
                return `
                    color: #22c55e;
                    background: rgba(34, 197, 94, 0.1);
                `
            case 'worktree':
                return `
                    color: #f59e0b;
                    background: rgba(245, 158, 11, 0.1);
                `
        }
    }}
`

const Chevron = styled.span<{ $expanded: boolean }>`
    font-size: 10px;
    opacity: 0.4;
    flex-shrink: 0;
    transition: transform 0.3s ease;
    transform: rotate(${({ $expanded }) => $expanded ? '180deg' : '0deg'});
`

interface SessionContextBarProps {
    metadata: SessionMetadataSummary | null
}

/**
 * Session 上下文信息条（吊顶效果）
 *
 * 展示当前 session 的环境上下文：工作目录、Git 分支、Worktree 状态。
 * 初始展开，3 秒后自动收起为紧凑模式。
 * 桌面端 hover 展开，移动端 tap 切换。
 */
export function SessionContextBar({ metadata }: SessionContextBarProps) {
    const isMobile = useIsMobile()
    const [expanded, setExpanded] = useState(true)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isPinnedRef = useRef(false)

    const hasContent = !!(metadata && (metadata.gitBranch || metadata.worktree))

    const startCollapseTimer = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            if (!isPinnedRef.current) {
                setExpanded(false)
            }
        }, AUTO_COLLAPSE_DELAY)
    }, [])

    // 初始展开，3 秒后收起
    useEffect(() => {
        if (!hasContent) return
        setExpanded(true)
        isPinnedRef.current = false
        startCollapseTimer()
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [hasContent, startCollapseTimer])

    const handleMouseEnter = useCallback(() => {
        if (isMobile) return
        if (timerRef.current) clearTimeout(timerRef.current)
        setExpanded(true)
    }, [isMobile])

    const handleMouseLeave = useCallback(() => {
        if (isMobile) return
        if (!isPinnedRef.current) {
            startCollapseTimer()
        }
    }, [isMobile, startCollapseTimer])

    const handleClick = useCallback(() => {
        if (!isMobile) return
        setExpanded(prev => {
            isPinnedRef.current = !prev
            return !prev
        })
    }, [isMobile])

    if (!hasContent) return null

    const gitBranch = metadata!.gitBranch
    const worktree = metadata!.worktree
    const path = metadata!.path

    return (
        <BarContainer
            $expanded={expanded}
            role="button"
            aria-label="session-context"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
        >
            <SummaryRow>
                <Chevron $expanded={expanded}>▼</Chevron>
                {gitBranch && (
                    <Tag $variant="branch">
                        <GitBranch size={11} />
                        {gitBranch}
                    </Tag>
                )}
                {worktree && (
                    <Tag $variant="worktree">
                        <FolderTree size={11} />
                        {worktree.name}
                    </Tag>
                )}
            </SummaryRow>
            <DetailRow $visible={expanded}>
                {path && (
                    <Tag $variant="path">
                        📁 {path}
                    </Tag>
                )}
            </DetailRow>
        </BarContainer>
    )
}
