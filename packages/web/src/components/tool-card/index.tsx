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

import type { ToolCallBlock } from '@/domain/tool/types'
import type { MobiApi } from '@/core/data/api/client'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isObject, safeStringify } from '@mobi/shared'
import { Card, Typography, Modal, theme as antTheme } from 'antd'
import type { GlobalToken } from 'antd/es/theme/interface'
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    LoadingOutlined,
    LockOutlined,
    RightOutlined
} from '@ant-design/icons'
import { PermissionFooter } from './PermissionFooter'
import { AskUserQuestionFooter } from './AskUserQuestionFooter'
import { RequestUserInputFooter } from './RequestUserInputFooter'
import { isAskUserQuestionToolName } from '@/domain/tool/askUserQuestion'
import { isRequestUserInputToolName } from '@/domain/tool/requestUserInput'
import { getToolPresentation, isTerminalTool, isAgentTool } from './knownTools'
import { getToolIcon } from './toolIcons'
import { getToolFullViewComponent, getToolViewComponent, type ToolViewComponent } from './views/_all'
import { getToolResultViewComponent } from './views/_results'
import { getInputString, getInputStringAny, truncate } from '@/core/lib/toolInputUtils'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/components/ui/Markdown'

// 重新导出 types 以供其他组件使用
export type { ToolCallBlock, ToolPermission } from '@/domain/tool/types'

const { Text } = Typography
const { useToken } = antTheme

const ELAPSED_INTERVAL_MS = 1000

function ElapsedView(props: { from: number; active: boolean }) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!props.active) return
        const id = setInterval(() => setNow(Date.now()), ELAPSED_INTERVAL_MS)
        return () => clearInterval(id)
    }, [props.active])

    if (!props.active) return null

    const elapsed = (now - props.from) / 1000
    if (!Number.isFinite(elapsed)) return null

    return (
        <Text type="secondary" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {elapsed.toFixed(1)}s
        </Text>
    )
}

// Task 状态图标
function TaskStateIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    const { token } = useToken()
    if (props.state === 'completed') {
        return <CheckCircleOutlined style={{ color: token.colorSuccess }} />
    }
    if (props.state === 'error') {
        return <CloseCircleOutlined style={{ color: token.colorError }} />
    }
    if (props.state === 'pending') {
        return <LockOutlined style={{ color: token.colorWarning }} />
    }
    return <LoadingOutlined style={{ color: token.colorPrimary }} spin />
}

// 获取 Task 子任务摘要
function getTaskSummaryChildren(block: ToolCallBlock): { visible: ToolCallBlock[]; remaining: number } | null {
    if (!isAgentTool(block.tool.name)) return null

    const children = block.children
        .filter((child): child is ToolCallBlock => child.kind === 'tool-call')
        .filter((child) => child.tool.state === 'pending' || child.tool.state === 'running' || child.tool.state === 'completed' || child.tool.state === 'error')

    if (children.length === 0) return null

    const visible = children.slice(-3)
    return { visible, remaining: children.length - visible.length }
}

// 渲染 Task 摘要
function renderTaskSummary(block: ToolCallBlock, metadata: SessionMetadataSummary | null, token: GlobalToken): ReactNode | null {
    const summary = getTaskSummaryChildren(block)
    if (!summary) return null

    const visible = summary.visible
    const remaining = summary.remaining

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visible.map((child) => (
                    <div key={child.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: token.colorTextSecondary }}>
                            <span style={{ marginRight: 8, display: 'inline-block', width: 16, textAlign: 'center', verticalAlign: 'middle' }}>
                                <TaskStateIcon state={child.tool.state} />
                            </span>
                            <span style={{ verticalAlign: 'middle', wordBreak: 'break-all' }}>
                                {formatTaskChildLabel(child, metadata)}
                            </span>
                        </div>
                    </div>
                ))}
                {remaining > 0 ? (
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, fontStyle: 'italic' }}>
                        (+{remaining} more)
                    </div>
                ) : null}
            </div>
        </div>
    )
}

// 格式化 Task 子任务标签
function formatTaskChildLabel(child: ToolCallBlock, metadata: SessionMetadataSummary | null): string {
    const presentation = getToolPresentation({
        toolName: child.tool.name,
        input: child.tool.input,
        result: child.tool.result,
        childrenCount: child.children.length,
        description: child.tool.description,
        metadata
    })

    if (presentation.subtitle) {
        return truncate(`${presentation.title}: ${presentation.subtitle}`, 140)
    }

    return presentation.title
}

/** 提取 Agent 工具的 prompt 文本 */
export function getAgentPrompt(input: unknown): string | null {
    return isObject(input) && typeof input.prompt === 'string' ? input.prompt : null
}

// 渲染 Agent 工具输入（运行中显示 prompt，完成后显示 result）
function renderAgentInput(block: ToolCallBlock, ResultView: ToolViewComponent, metadata: SessionMetadataSummary | null): ReactNode {
    const prompt = getAgentPrompt(block.tool.input)
    if (!prompt) return null
    if (block.tool.state === 'running' || block.tool.state === 'pending') {
        return <Markdown content={prompt} />
    }
    return <ResultView block={block} metadata={metadata} />
}

// 渲染工具输入
function renderToolInput(block: ToolCallBlock, token: GlobalToken): ReactNode {
    const toolName = block.tool.name
    const input = block.tool.input

    if (toolName === 'Edit') {
        const diff = renderEditInput(input)
        if (diff) return diff
    }

    if (toolName === 'MultiEdit' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
        const edits = Array.isArray(input.edits) ? input.edits : null
        if (edits && edits.length > 0) {
            const rendered = edits
                .slice(0, 3)
                .map((edit, idx) => {
                    if (!isObject(edit)) return null
                    const oldString = getInputString(edit, 'old_string')
                    const newString = getInputString(edit, 'new_string')
                    if (oldString === null || newString === null) return null
                    return (
                        <div key={idx}>
                            <InlineDiffView oldString={oldString} newString={newString} filePath={filePath} />
                        </div>
                    )
                })
                .filter(Boolean)

            if (rendered.length > 0) {
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rendered}
                        {edits.length > 3 ? (
                            <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                                (+{edits.length - 3} more edits)
                            </div>
                        ) : null}
                    </div>
                )
            }
        }
    }

    if (toolName === 'Write' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const content = getInputStringAny(input, ['content', 'text'])
        if (filePath && content !== null) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" />
                </div>
            )
        }
    }

    if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode') {
        const plan = renderExitPlanModeInput(input)
        if (plan) return plan
    }

    const commandArray = isObject(input) && Array.isArray(input.command) ? input.command : null
    if (toolName === 'Bash' && (typeof commandArray?.[0] === 'string' || typeof input === 'object')) {
        const cmd = Array.isArray(commandArray)
            ? commandArray.filter((part) => typeof part === 'string').join(' ')
            : getInputStringAny(input, ['command', 'cmd'])
        if (cmd) {
            return <CodeBlock code={cmd} language="bash" />
        }
    }

    return <CodeBlock code={safeStringify(input)} language="json" />
}

// 渲染 Edit 输入
function renderEditInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
    const oldString = getInputString(input, 'old_string')
    const newString = getInputString(input, 'new_string')
    if (oldString === null || newString === null) return null

    return (
        <InlineDiffView oldString={oldString} newString={newString} filePath={filePath} />
    )
}

// 渲染 ExitPlanMode 输入
function renderExitPlanModeInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const plan = getInputString(input, 'plan')
    if (!plan) return null
    return <Markdown content={plan} />
}

// 状态图标
function StatusIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    const { token } = useToken()
    if (props.state === 'completed') {
        return <CheckCircleOutlined style={{ fontSize: 12, color: token.colorSuccess }} />
    }
    if (props.state === 'error') {
        return <CloseCircleOutlined style={{ fontSize: 12, color: token.colorError }} />
    }
    if (props.state === 'pending') {
        return <LockOutlined style={{ fontSize: 12, color: token.colorWarning }} />
    }
    return <LoadingOutlined style={{ fontSize: 12, color: token.colorPrimary }} spin />
}

// 状态颜色
function statusColorClass(state: ToolCallBlock['tool']['state'], token: ReturnType<typeof useToken>['token']): string {
    if (state === 'completed') return token.colorSuccess
    if (state === 'error') return token.colorError
    if (state === 'pending') return token.colorWarning
    return token.colorTextSecondary
}


// 代码块组件
function CodeBlock(props: { code: string; language?: string }) {
    const { token } = useToken()
    return (
        <pre style={{
            background: token.colorBgContainer,
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            overflowX: 'auto',
            margin: '4px 0',
            border: `1px solid ${token.colorBorder}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
        }}>
            {props.code}
        </pre>
    )
}

// 内联 Diff 视图
function InlineDiffView(props: { oldString: string; newString: string; filePath?: string }) {
    const { token } = useToken()
    const lines: ReactNode[] = []
    const oldLines = props.oldString.split('\n')
    const newLines = props.newString.split('\n')

    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
        const oldLine = oldLines[i]
        const newLine = newLines[i]

        if (oldLine !== undefined && oldLine !== newLine) {
            lines.push(
                <div key={`old-${i}`} style={{ background: token.colorErrorBg, color: token.colorError, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre', paddingLeft: 8 }}>
                    - {oldLine}
                </div>
            )
        }
        if (newLine !== undefined) {
            lines.push(
                <div key={`new-${i}`} style={{ background: token.colorSuccessBg, color: token.colorSuccess, fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre', paddingLeft: 8 }}>
                    + {newLine}
                </div>
            )
        }
    }

    return (
        <div style={{ border: `1px solid ${token.colorBorder}`, borderRadius: 4, overflow: 'hidden' }}>
            {props.filePath && (
                <div style={{ padding: '4px 8px', background: token.colorBgLayout, fontSize: 11, color: token.colorTextSecondary }}>
                    {props.filePath}
                </div>
            )}
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {lines}
            </div>
        </div>
    )
}

type ToolCardProps = {
    api: MobiApi
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
}

function ToolCardInner(props: ToolCardProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata
    }), [
        props.block.tool.name,
        props.block.tool.input,
        props.block.tool.result,
        props.block.children.length,
        props.block.tool.description,
        props.metadata
    ])

    const toolName = props.block.tool.name
    const toolTitle = presentation.title
    const subtitle = presentation.subtitle ?? props.block.tool.description
    const taskSummary = renderTaskSummary(props.block, props.metadata, token)
    const runningFrom = props.block.tool.startedAt ?? props.block.tool.createdAt
    const permission = props.block.tool.permission
    const isAskUserQuestion = isAskUserQuestionToolName(toolName)
    const isRequestUserInput = isRequestUserInputToolName(toolName)
    const isQuestionTool = isAskUserQuestion || isRequestUserInput
    const showsToolFooter = Boolean(permission && (
        permission.status === 'pending'
        || ((permission.status === 'denied' || permission.status === 'canceled') && Boolean(permission.reason))
    ))
    const isAgentToolCard = isAgentTool(toolName)
    const showInline = !presentation.minimal && !isAgentTool(toolName) && !isAskUserQuestion
    const CompactToolView = showInline ? getToolViewComponent(toolName) : null
    const FullToolView = getToolFullViewComponent(toolName)
    const ResultToolView = getToolResultViewComponent(toolName)
    const hasBody = isAskUserQuestion
        ? showsToolFooter
        : showInline || isAgentToolCard || taskSummary !== null || showsToolFooter
    const stateColor = statusColorClass(props.block.tool.state, token)

    const [modalOpen, setModalOpen] = useState(false)

    const header = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorTextSecondary }}>
                        {getToolIcon(toolName, { id: props.block.id, state: props.block.tool.state })}
                    </div>
                    <Text strong style={{ minWidth: 0, fontSize: 13, lineHeight: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 0' }}>
                        {toolTitle}
                    </Text>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} />
                    <span style={{ color: stateColor }}>
                        <StatusIcon state={props.block.tool.state} />
                    </span>
                    <RightOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
                </div>
            </div>

            {subtitle ? (
                <Text type="secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, wordBreak: 'break-all', opacity: 0.8 }}>
                    {truncate(subtitle, 160)}
                </Text>
            ) : null}
        </div>
    )

    return (
        <Card
            size="small"
            className="tool-card"
            style={{ overflow: 'hidden' }}
        >
            <div
                style={{ padding: 12, cursor: 'pointer' }}
                onClick={() => setModalOpen(true)}
            >
                {header}
            </div>

            {hasBody ? (
                <div style={{ padding: '0 12px 12px' }}>
                    {taskSummary ? (
                        <div style={{ marginTop: 8 }}>
                            {taskSummary}
                        </div>
                    ) : null}

                    {isAgentToolCard ? (
                        <div style={{ marginTop: 12 }}>
                            {renderAgentInput(props.block, ResultToolView, props.metadata)}
                        </div>
                    ) : null}

                    {showInline ? (
                        CompactToolView ? (
                            <div style={{ marginTop: 12 }}>
                                <CompactToolView block={props.block} metadata={props.metadata} />
                            </div>
                        ) : (
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div>
                                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.tool.input')}</div>
                                    {renderToolInput(props.block, token)}
                                </div>
                                <div>
                                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} />
                                </div>
                            </div>
                        )
                    ) : null}

                    {isAskUserQuestion && permission?.status === 'pending' ? (
                        <AskUserQuestionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : isRequestUserInput && permission?.status === 'pending' ? (
                        <RequestUserInputFooter
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : (
                        <PermissionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            metadata={props.metadata}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    )}
                </div>
            ) : null}

            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                title={toolTitle}
                width={640}
            >
                {(() => {
                    const isQuestionToolWithAnswers = isQuestionTool
                        && permission?.answers
                        && Object.keys(permission.answers).length > 0

                    // Agent 工具：展示 Prompt 和 Result
                    if (isAgentToolCard) {
                        const agentPrompt = getAgentPrompt(props.block.tool.input)
                        return (
                            <div style={{ marginTop: 12, display: 'flex', maxHeight: '75dvh', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
                                {agentPrompt ? (
                                    <div>
                                        <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>Prompt</div>
                                        <Markdown content={agentPrompt} />
                                    </div>
                                ) : null}
                                <div>
                                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} />
                                </div>
                            </div>
                        )
                    }

                    return (
                        <div style={{ marginTop: 12, display: 'flex', maxHeight: '75dvh', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
                            <div>
                                <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                                    {isQuestionToolWithAnswers ? t('chat.tool.questionsAnswers') : t('chat.tool.input')}
                                </div>
                                {FullToolView ? (
                                    <FullToolView block={props.block} metadata={props.metadata} />
                                ) : (
                                    renderToolInput(props.block, token)
                                )}
                            </div>
                            {!isQuestionToolWithAnswers && !(FullToolView && isTerminalTool(toolName)) && (
                                <div>
                                    <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>{t('chat.tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} />
                                </div>
                            )}
                        </div>
                    )
                })()}
            </Modal>
        </Card>
    )
}

export const ToolCard = memo(ToolCardInner)
