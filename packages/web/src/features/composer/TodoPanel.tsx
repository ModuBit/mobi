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
 * 清单面板（todo + task 合并展示）——气泡 Popover 详情的平铺形态
 * CLI 的 TodoWrite 清单（todos）与任务清单（tasks）是同一类呈现，合并进一个列表：
 * 一个头行（图标 + 进行中文案 + 合并完成统计 + 清理）+ 一条按状态排序的胶囊行列表。
 * - 行形态借鉴 beautifului Task Rows：状态徽标（完成对勾 / 进行中转环 / 待办空环）、
 *   label、完成态胶囊；行高 44、圆角 22，展开时收紧到 14
 * - todo 行显示 content，task 行显示 subject（不展示内部数字 id）
 * - task 有 description 时整行成为展开按钮，详情落在状态列下方的导轨里；
 *   todo 没有副信息，保持静态行（不造假数据，也不做无内容的展开）
 * - 合并/排序/统计口径见 checklist.ts（气泡摘要共用同一份）
 */

import { memo, useMemo, useState } from 'react'
import styled from '@emotion/styled'
import { css, keyframes } from '@emotion/react'
import { Check, ChevronDown, Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TodoItem, TaskItem } from '@mobi/shared'
import { ClearStateButton, type ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { ShinyText } from '@/ui/base/motion/ShinyText'
import { buildChecklist, type ChecklistEntry, type ChecklistStatus } from './checklist'

/** 任务橙色，参考 Claude Code */
const CHECKLIST_ORANGE = '#e8825c'

/** 胶囊行几何（行高 44 / 行距 8；圆角取档：收起面板档 22、展开控件档 14） */
const ROW_HEIGHT = 44
const ROW_RADIUS = 'var(--radius-panel)'
const ROW_RADIUS_OPEN = 'var(--radius-control)'
const ROW_GAP = 8
/** 行内左右内衬（= 状态槽与文字间距）：DetailRow 必须与行布局同值，导轨竖线才正对状态槽 */
const ROW_INSET = 10

/**
 * 颜色只用 shadcn/UIARC 全局变量（--muted / --text-secondary / --muted-foreground /
 * --border-subtle），不要用 --ant-color-*：本面板挂在 portal 到 body 的 Popover 里，
 * antd cssVar 的作用域只在 antd 子树内，--ant-* 在弹层里全部解析为空
 * （底色/描边/字色一起静默失效，2026-10-18 E2E 实拍：行底与转环整片消失）
 */

/** 状态转环几何 */
const RING_SIZE = 24
const RING_STROKE = 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const spin = keyframes`
    to { transform: rotate(360deg); }
`

const List = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ROW_GAP}px;
`

/** 每行一张胶囊；展开时圆角收紧，detail 从下方长出 */
const Row = styled.div<{ $open: boolean }>`
    overflow: hidden;
    border-radius: ${({ $open }) => ($open ? ROW_RADIUS_OPEN : ROW_RADIUS)};
    /* --muted 在 light/dark 两档都是可辨识的一层浅面，又不至于像卡片那样抢眼 */
    background: var(--muted);
    transition: border-radius var(--mobi-duration-mid) var(--mobi-ease-out);
    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`

const rowLayout = css`
    display: flex;
    align-items: center;
    gap: ${ROW_INSET}px;
    box-sizing: border-box;
    width: 100%;
    height: ${ROW_HEIGHT}px;
    padding: 0 ${ROW_INSET}px;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
`

/** 可展开行（有 description 的 task） */
const RowButton = styled.button`
    ${rowLayout};
    cursor: pointer;

    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: -2px;
    }
`

/** 无副信息的静态行（todo / 无 description 的 task） */
const RowStatic = styled.div`
    ${rowLayout};
`

/** 三态共用的 24px 状态槽：完成徽标 22px 在其中居中，保证所有行 label 起点一致 */
const StatusSlot = styled.span`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: ${RING_SIZE}px;
    height: ${RING_SIZE}px;
`

/** 完成态：22px 黑灰圆底 + 反向墨色对勾（与完成行的灰阶文字同一体系） */
const CheckBadge = styled.span`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-pill);
    background: var(--muted-foreground);
    color: var(--background);
`

/** 进行中：24px 转环（1.1s 匀速）；待办：同一轨道的静态空环 */
const RingSvg = styled.svg<{ $active: boolean }>`
    flex: none;
    ${({ $active }) => $active && css`animation: ${spin} 1.1s linear infinite;`}

    @media (prefers-reduced-motion: reduce) {
        animation: none;
    }
`

const Label = styled.span<{ $status: ChecklistStatus }>`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 13px;
    font-weight: ${({ $status }) => ($status === 'in_progress' ? 600 : 500)};
    line-height: 1.3;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: ${({ $status }) => {
        if ($status === 'in_progress') return CHECKLIST_ORANGE
        if ($status === 'completed') return 'var(--muted-foreground)'
        return 'var(--text-secondary)'
    }};
    text-decoration: ${({ $status }) => ($status === 'completed' ? 'line-through' : 'none')};
`

/** 完成态胶囊：与参考组件同尺寸（22 高 / 11.5 字），灰阶与完成行一致 */
const StatusPill = styled.span`
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--muted-foreground) 14%, transparent);
    color: var(--muted-foreground);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
`

/** 旋转放在外层 span：styled(lucide 组件) 不会过滤 $open，瞬态 prop 会漏到 svg 上 */
const ChevronSlot = styled.span<{ $open: boolean }>`
    display: inline-flex;
    flex: none;
    color: var(--muted-foreground);
    transform: rotate(${({ $open }) => ($open ? 180 : 0)}deg);
    transition: transform var(--mobi-duration-mid) var(--mobi-ease-out);

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`

/** 详情抽屉：grid-template-rows 0fr ↔ 1fr 过渡，内容始终在 DOM 里 */
const DetailGrid = styled.div<{ $open: boolean }>`
    display: grid;
    grid-template-rows: ${({ $open }) => ($open ? '1fr' : '0fr')};
    opacity: ${({ $open }) => ($open ? 1 : 0)};
    transition:
        grid-template-rows var(--mobi-duration-mid) var(--mobi-ease-out),
        opacity var(--mobi-duration-mid) var(--mobi-ease-out);

    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`

const DetailOverflow = styled.div`
    overflow: hidden;
`

const DetailRow = styled.div`
    display: flex;
    gap: ${ROW_INSET}px;
    padding: 0 ${ROW_INSET}px ${ROW_INSET}px;
`

/** 与行首状态槽同宽的导轨列，让竖线正对状态徽标中心 */
const DetailRailSlot = styled.span`
    display: flex;
    flex: none;
    justify-content: center;
    width: ${RING_SIZE}px;
`

const DetailRail = styled.span`
    width: 1px;
    background: var(--border-subtle);
`

const DetailText = styled.p`
    margin: 0;
    min-width: 0;
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 18px;
    overflow-wrap: anywhere;
`

export type TodoPanelProps = {
    todos: TodoItem[] | undefined
    tasks: TaskItem[] | undefined
    sessionId: string
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}

function TodoPanelInner({ todos, tasks, sessionId, onClear }: TodoPanelProps) {
    const { t } = useTranslation()
    const checklist = useMemo(() => buildChecklist(todos, tasks), [todos, tasks])
    const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({})

    if (checklist.items.length === 0) return null
    const { items, completed, total, activeText } = checklist

    // 确认文案必须与真实清理范围一致：清理固定同时作用于 todos 与 tasks
    const hasTodos = (todos?.length ?? 0) > 0
    const hasTaskEntries = items.some(entry => entry.kind === 'task')
    const clearConfirmKey = hasTodos && hasTaskEntries
        ? 'chat.clearState.checklist'
        : hasTodos ? 'chat.clearState.todos' : 'chat.clearState.tasks'

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Lightbulb size={14} color={CHECKLIST_ORANGE} />
            {activeText ? (
                <ShinyText solid style={{ color: CHECKLIST_ORANGE }}>
                    {activeText}
                </ShinyText>
            ) : completed === total ? (
                <span style={{ color: 'var(--muted-foreground)', fontWeight: 500 }}>✓ {t('chat.todo.allCompleted')}</span>
            ) : (
                <span style={{ color: 'var(--muted-foreground)' }}>
                    {t('chat.task.pendingCount', { count: total - completed })}
                </span>
            )}
            <ClearStateButton
                sessionId={sessionId}
                clearFields={["todos", "tasks"]}
                confirmKey={clearConfirmKey}
                onClear={onClear}
            />
        </div>
    )

    const list = (
        <List>
            {items.map((entry) => {
                const detail = entry.kind === 'task' ? entry.task.description : undefined
                const expandable = Boolean(detail)
                const open = expandable && Boolean(openKeys[entry.key])
                const label = entryLabel(entry)
                // 状态槽是纯视觉的（aria-hidden），非完成态补一份读屏可读的状态文案
                const srStatus = entry.status === 'in_progress'
                    ? t('chat.todo.inProgress')
                    : entry.status === 'pending' ? t('chat.todo.pending') : null

                const content = (
                    <>
                        <StatusMark status={entry.status} />
                        <Label $status={entry.status} title={label}>{label}</Label>
                        {srStatus && <span className="sr-only">{srStatus}</span>}
                        {entry.status === 'completed' && (
                            <StatusPill>{t('chat.todo.completed')}</StatusPill>
                        )}
                        {expandable && (
                            <ChevronSlot $open={open} aria-hidden="true">
                                <ChevronDown size={15} />
                            </ChevronSlot>
                        )}
                    </>
                )

                return (
                    <Row key={entry.key} $open={open}>
                        {expandable ? (
                            <RowButton
                                type="button"
                                aria-expanded={open}
                                onClick={() => setOpenKeys(prev => ({ ...prev, [entry.key]: !prev[entry.key] }))}
                            >
                                {content}
                            </RowButton>
                        ) : (
                            <RowStatic>{content}</RowStatic>
                        )}
                        {expandable && (
                            /* 收起时内容常驻 DOM（0fr 过渡需要），必须对辅助技术隐藏 */
                            <DetailGrid $open={open} aria-hidden={!open}>
                                <DetailOverflow>
                                    <DetailRow>
                                        <DetailRailSlot aria-hidden="true"><DetailRail /></DetailRailSlot>
                                        <DetailText>{detail}</DetailText>
                                    </DetailRow>
                                </DetailOverflow>
                            </DetailGrid>
                        )}
                    </Row>
                )
            })}
        </List>
    )

    // 外衬（纵向 flex / 间距 / 最小宽）与限高内滚由气泡详情容器提供
    return (
        <>
            {header}
            {list}
        </>
    )
}

/**
 * memo：面板挂在弹层里，而父级（ChatContainer → ComposerStatusPills）每个流式帧都会
 * 重渲染；props（runtimeState 的 todos/tasks、稳定回调）在无清单变化时引用不变，
 * memo 让整棵胶囊行树在流式期 bailout。
 */
export const TodoPanel = memo(TodoPanelInner)

function entryLabel(entry: ChecklistEntry): string {
    return entry.kind === 'todo' ? entry.todo.content : entry.task.subject
}

/** 行首状态槽：完成对勾 / 进行中转环 / 待办空环（三态同一 24px 槽位，纯视觉） */
function StatusMark({ status }: { status: ChecklistStatus }) {
    if (status === 'completed') {
        return (
            <StatusSlot aria-hidden="true">
                <CheckBadge>
                    <Check size={12} strokeWidth={3.5} />
                </CheckBadge>
            </StatusSlot>
        )
    }

    const active = status === 'in_progress'
    return (
        <StatusSlot aria-hidden="true">
            <RingSvg
                width={RING_SIZE}
                height={RING_SIZE}
                viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                $active={active}
            >
                <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.45}
                    strokeWidth={RING_STROKE}
                />
                {active && (
                    <circle
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RING_RADIUS}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={RING_STROKE}
                        strokeLinecap="round"
                        strokeDasharray={`${RING_CIRCUMFERENCE * 0.28} ${RING_CIRCUMFERENCE * 0.72}`}
                    />
                )}
            </RingSvg>
        </StatusSlot>
    )
}
