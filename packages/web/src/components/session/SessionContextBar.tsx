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
import type { GoalStatus } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { ClearRuntimeStateField } from '@/components/composer/ClearStateButton'
import { GoalChip } from './GoalChip'
import { GoalDetail } from './GoalDetail'

/** 自动收起延迟（毫秒） */
const AUTO_COLLAPSE_DELAY = 3000

// 常驻薄条（收起/展开都占位），高度恒定——展开内容用 DetailPopover 浮出，不挤压对话区
// $hasGoal=false 时退化为静态信息条（role=status，无 cursor/交互），保持原 077f703 行为零回归
const BarContainer = styled.div<{ $hasGoal: boolean }>`
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    padding: 4px 12px;
    background: var(--ant-color-bg-container);
    border-bottom: 1px solid var(--ant-color-border-secondary);
    cursor: ${({ $hasGoal }) => ($hasGoal ? 'pointer' : 'default')};
    user-select: ${({ $hasGoal }) => ($hasGoal ? 'none' : 'text')};
`

// 展开态浮层：绝对定位紧贴 bar 下沿，叠在对话区之上（不占文档流，不挤压对话）。
// 阴影 + 实色背景 + 淡入下移动画，制造「浮动卡片」层次，两主题靠 antd CSS 变量自适应
const DetailPopover = styled.div`
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 10;
    background: var(--ant-color-bg-container);
    border-bottom: 1px solid var(--ant-color-border);
    box-shadow: var(--ant-box-shadow);
    animation: scb-popover-in 0.18s ease;
    @keyframes scb-popover-in {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
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

const StyledChevron = styled(ChevronDown, { shouldForwardProp: (p) => !p.startsWith('$') })<{ $expanded: boolean }>`
    opacity: 0.3;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    transform: rotate(${({ $expanded }) => ($expanded ? '180deg' : '0deg')});
`

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
    flex-shrink: 0;
`

interface SessionContextBarProps {
    metadata: SessionMetadataSummary | null
    /** goal 状态（有值时收起态追加 chip，展开态在浮层展示详情） */
    goal?: GoalStatus | null
    sessionId: string
    onClearGoal: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * Session 上下文信息条（吊顶效果）
 *
 * 展示当前 session 的环境上下文：工作目录、Git 分支、Worktree 状态，附 goal 状态。
 * 常驻薄条占位；展开内容（goal 详情）以浮层叠在对话区上方，不挤压对话。
 * PC 和移动端行为一致：
 * 1. 进入 session 默认展开，3 秒后自动收起
 * 2. 点击吊顶切换展开/收起
 * 3. 展开态点击吊顶以外任意区域即收起（drawer 语义）
 */
export function SessionContextBar({ metadata, goal, sessionId, onClearGoal }: SessionContextBarProps) {
    const [expanded, setExpanded] = useState(true)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const barRef = useRef<HTMLDivElement>(null)

    const hasContent = Boolean(metadata && metadata.path)
    // 展开交互（chevron / auto-collapse / drawer）仅在有 goal 时启用；
    // 无 goal 时保持原静态信息条行为（role=status，零回归）
    const hasGoal = Boolean(goal)

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

    // 初始展开，3 秒后收起（仅 goal 存在时挂载——无 goal 无展开内容，timer 纯属浪费）
    useEffect(() => {
        if (!hasContent || !hasGoal) return
        setExpanded(true)
        startCollapseTimer()
        return clearCollapseTimer
    }, [hasContent, hasGoal, startCollapseTimer, clearCollapseTimer])

    // drawer 语义：展开态时点击吊顶以外任意区域即收起（仅 goal 存在时才需要）
    // 用 document mousedown + ref 命中判断，不渲染全屏 mask——
    // 避免与 Layout 的 stacking context 冲突，也不阻塞对话区/composer 交互
    useEffect(() => {
        if (!hasGoal || !expanded) return
        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node | null
            if (target && barRef.current && !barRef.current.contains(target)) {
                clearCollapseTimer()
                setExpanded(false)
            }
        }
        document.addEventListener('mousedown', onPointerDown)
        return () => document.removeEventListener('mousedown', onPointerDown)
    }, [hasGoal, expanded, clearCollapseTimer])

    const handleClick = useCallback(() => {
        clearCollapseTimer()
        setExpanded((prev) => !prev)
    }, [clearCollapseTimer])

    if (!hasContent) return null

    const gitBranch = metadata!.gitBranch
    const worktree = metadata!.worktree
    const path = metadata!.path

    return (
        <BarContainer
            ref={barRef}
            role={hasGoal ? 'button' : 'status'}
            aria-label="session-context"
            data-expanded={expanded}
            data-testid="session-context-bar"
            $hasGoal={hasGoal}
            onClick={hasGoal ? handleClick : undefined}
        >
            <ContentRow>
                {hasGoal && <StyledChevron $expanded={expanded} size={14} />}
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
                {/* 收起态：goal 状态 chip（点击切换展开/收起） */}
                {!expanded && goal ? <GoalChip goal={goal} sessionId={sessionId} onClear={onClearGoal} /> : null}
            </ContentRow>
            {/* 展开态：goal 详情浮层（条件 / evaluator 理由 / 统计）——绝对定位，不挤压对话区。
                stopPropagation：浮层是 BarContainer 的 DOM 子节点，点击浮层内容会冒泡到
                BarContainer.onClick 触发 toggle 收起；阻断冒泡，让浮层内容可正常查看/交互 */}
            {expanded && goal ? (
                <DetailPopover onClick={(e) => e.stopPropagation()}>
                    <GoalDetail goal={goal} sessionId={sessionId} onClear={onClearGoal} />
                </DetailPopover>
            ) : null}
        </BarContainer>
    )
}
