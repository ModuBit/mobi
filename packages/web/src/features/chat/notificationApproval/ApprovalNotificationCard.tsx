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

import { useEffect, useMemo } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/core/data/hooks/queries/useSession'
import { useMobiApi } from '@/core/data/api/client'
import { Button } from '@/ui/base/interactive/button/Button'
import { getPermissionDescription } from '@/core/lib/toolInputUtils'
import type { ToolInfo } from '@/domain/tool/types'
import { isAskUserQuestionToolName } from '@/domain/tool/askUserQuestion'
import { isRequestUserInputToolName } from '@/domain/tool/requestUserInput'
import { isElicitationToolName } from '@/domain/tool/elicitation'
import type { ApprovalNotificationItem } from '@/core/data/stores/approvalNotificationStore'
import { PermissionFooter } from '../tool-card/PermissionFooter'
import { AskUserQuestionFooter } from '../tool-card/AskUserQuestionFooter'
import { RequestUserInputFooter } from '../tool-card/RequestUserInputFooter'

const { useToken } = antTheme

type ApprovalNotificationCardProps = {
    item: ApprovalNotificationItem
    /** 请求已处理（本卡片操作成功，或在别处处理/会话消失）→ 收起通知 */
    onResolved: () => void
    /** 打开对应会话（点卡片空白区同效） */
    onOpen: () => void
}

/**
 * 通知内嵌的审批卡片。
 *
 * 与聊天流里的审批面板取同一套组件（PermissionFooter / AskUserQuestionFooter /
 * RequestUserInputFooter），行为、档位、错误处理天然一致；本卡片只负责
 * 「取请求 → 构造 ToolInfo → 收起通知」，不复制任何审批逻辑。
 *
 * 数据源是 session.agentState.requests（唯一事实源）：通知只带 requestId 指针，
 * 会话数据随 SSE 更新，请求在别处被处理时这里会因请求消失而自动收起。
 */
export function ApprovalNotificationCard({ item, onResolved, onOpen }: ApprovalNotificationCardProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const api = useMobiApi()
    const { data: session, isError } = useSession(item.sessionId)

    // 锚定的请求；老 daemon 没带 requestId 时回退第一条待审批
    const target = useMemo(() => {
        const requests = session?.agentState?.requests ?? null
        if (!requests) return null
        if (item.requestId && requests[item.requestId]) {
            return { id: item.requestId, request: requests[item.requestId]! }
        }
        const first = Object.entries(requests)[0]
        return first ? { id: first[0], request: first[1] } : null
    }, [session?.agentState?.requests, item.requestId])

    // 会话已加载但请求不在了（本地批完 / 在会话页批完 / 会话被删）→ 通知失去意义，收起
    useEffect(() => {
        if (isError) onResolved()
        else if (session && !target) onResolved()
    }, [isError, session, target, onResolved])

    const tool = useMemo<ToolInfo | null>(() => {
        if (!target) return null
        const { id, request } = target
        return {
            name: request.tool,
            input: request.arguments,
            result: null,
            state: 'pending',
            description: null,
            startedAt: null,
            createdAt: request.createdAt ?? 0,
            permission: {
                id,
                status: 'pending',
                createdAt: request.createdAt ?? null,
                suggestions: request.suggestions,
            },
            sdkHints: request.sdkHints,
        }
    }, [target])

    const summary = useMemo(() => {
        if (!tool) return ''
        // 问答类工具的内容本身就是问题清单，再叠一行摘要只会和标题重复
        if (isAskUserQuestionToolName(tool.name) || isRequestUserInputToolName(tool.name)) return ''
        const desc = getPermissionDescription(tool.name, tool.input)
        return desc && desc !== item.body ? desc : ''
    }, [tool, item.body])

    const isAskUserQuestion = tool ? isAskUserQuestionToolName(tool.name) : false
    const isRequestUserInput = tool ? isRequestUserInputToolName(tool.name) : false
    const isElicitation = tool ? isElicitationToolName(tool.name) : false

    return (
        // 操作区与通知整体点击（跳转）隔开：点按钮不跳走，点空白/标题才跳。
        // 内容高度不设限时，多题问答/长选项列表会把通知撑出屏幕——限高内滚，
        // overscroll 收在卡片里，避免滚到底后带动页面（移动端尤其明显）
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 'min(60dvh, 560px)',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                paddingRight: 2,
            }}
        >
            {/* 会话跳转入口在通知标题行（见 ApprovalNotificationHost），卡片只留请求本身的内容 */}
            {item.body || summary ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    {item.body ? (
                        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{item.body}</div>
                    ) : null}
                    {summary ? (
                        <div style={{ fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                            {summary}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {tool && !isElicitation ? (
                isAskUserQuestion ? (
                    <AskUserQuestionFooter
                        api={api}
                        sessionId={item.sessionId}
                        tool={tool}
                        disabled={false}
                        onDone={onResolved}
                    />
                ) : isRequestUserInput ? (
                    <RequestUserInputFooter
                        sessionId={item.sessionId}
                        tool={tool}
                        disabled={false}
                        onDone={onResolved}
                    />
                ) : (
                    <PermissionFooter
                        api={api}
                        sessionId={item.sessionId}
                        metadata={null}
                        tool={tool}
                        disabled={false}
                        onDone={onResolved}
                    />
                )
            ) : (
                // elicitation 表单与会话上下文强绑定（会话页 ComposerInfoPanel 承载），
                // 通知里不重造一份，指引进会话处理
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                        {t('notification.openSessionToHandle')}
                    </div>
                    <Button variant="secondary" onClick={onOpen} style={{ minHeight: 32, justifyContent: 'center' }}>
                        {t('notification.openSession')}
                    </Button>
                </div>
            )}
        </div>
    )
}
