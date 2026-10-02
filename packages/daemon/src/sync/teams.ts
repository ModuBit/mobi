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

import { isObject } from '@mobi/shared'
import { unwrapOutputMessage } from '@mobi/shared/messages'
import type { TeamState } from '@mobi/shared/types'

type TeamStateDelta = Partial<TeamState> & { _action?: 'create' | 'delete' | 'update' }

/** 从内容块数组中过滤出带合法 name/input 的 tool_use 块 */
function extractToolBlocks(blocks: unknown[] | null): Array<{ id?: string; name: string; input: Record<string, unknown> }> {
    const result: Array<{ id?: string; name: string; input: Record<string, unknown> }> = []
    if (!blocks) return result

    for (const block of blocks) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        const name = typeof block.name === 'string' ? block.name : null
        if (!name) continue
        const input = isObject(block.input) ? block.input as Record<string, unknown> : null
        if (!input) continue
        const id = typeof block.id === 'string' ? block.id : undefined
        result.push({ id, name, input })
    }

    return result
}

function processTeamCreate(input: Record<string, unknown>): TeamStateDelta | null {
    const teamName = typeof input.team_name === 'string' ? input.team_name : null
    if (!teamName) return null

    return {
        _action: 'create',
        teamName,
        description: typeof input.description === 'string' ? input.description : undefined,
        members: [],
        tasks: [],
        messages: [],
        updatedAt: Date.now()
    }
}

function processTeamDelete(): TeamStateDelta {
    return { _action: 'delete' }
}

function processTaskToolWithTeam(toolUseId: string | undefined, input: Record<string, unknown>): TeamStateDelta | null {
    // SDK v2.1.178+：session 只有隐式单团队，team_name 已 deprecated（accepted but ignored）。
    // 不再要求 team_name；只用 name 是否存在来判定这是一次 teammate 派发——
    // 普通 subagent 的 Agent tool_use input 不带 name 字段，因此不会误注册。
    const name = typeof input.name === 'string' ? input.name : null
    if (!name) return null

    const agentType = typeof input.subagent_type === 'string' ? input.subagent_type : undefined
    const prompt = typeof input.prompt === 'string' ? input.prompt : undefined
    const description = typeof input.description === 'string' ? input.description : null

    return {
        _action: 'update',
        members: [{
            name,
            agentType,
            status: 'running',
            prompt,
            startedAt: Date.now(),
            // 记录派发 tool_use id：tool_result 到达时据此配对标记完成（teammate 生命周期出口）
            toolUseIds: toolUseId ? [toolUseId] : undefined,
        }],
        tasks: description ? [{
            id: `agent:${name}`,
            title: description,
            status: 'in_progress',
            owner: name,
        }] : undefined,
        updatedAt: Date.now()
    }
}

function processSendMessage(input: Record<string, unknown>): TeamStateDelta | null {
    const type = typeof input.type === 'string' ? input.type : null
    if (!type) return null

    const summary = typeof input.summary === 'string' ? input.summary : ''
    const recipient = typeof input.recipient === 'string' ? input.recipient : 'all'

    const validTypes = ['message', 'broadcast', 'shutdown_request', 'shutdown_response'] as const
    const msgType = validTypes.includes(type as typeof validTypes[number])
        ? type as typeof validTypes[number]
        : 'message'

    const delta: TeamStateDelta = {
        _action: 'update',
        messages: [{
            from: 'team-lead',
            to: msgType === 'broadcast' ? 'all' : recipient,
            summary,
            type: msgType,
            timestamp: Date.now()
        }],
        updatedAt: Date.now()
    }

    // If shutdown_request with approve=true, mark member as shutdown
    if (msgType === 'shutdown_request' && recipient) {
        delta.members = [{ name: recipient, status: 'shutdown' }]
    }

    return delta
}

export function extractTeamStateFromMessageContent(messageContent: unknown): TeamStateDelta | null {
    // 解包骨架收口在 unwrapOutputMessage（shared/messages）；此处只关心 assistant 消息的 tool_use
    const unwrapped = unwrapOutputMessage(messageContent)
    if (!unwrapped) return null
    if (unwrapped.role !== 'agent' && unwrapped.role !== 'assistant') return null
    if (unwrapped.data.type !== 'assistant') return null

    const blocks = extractToolBlocks(unwrapped.blocks)
    if (blocks.length === 0) return null

    let result: TeamStateDelta | null = null

    for (const block of blocks) {
        let delta: TeamStateDelta | null = null

        switch (block.name) {
            case 'TeamCreate':
                delta = processTeamCreate(block.input)
                break
            case 'TeamDelete':
                delta = processTeamDelete()
                break
            case 'Task':
            case 'Agent':
                delta = processTaskToolWithTeam(block.id, block.input)
                break
            // TaskCreate/TaskUpdate 不在此解析：task 状态的单一真相源是
            // runtime_state.tasks（由 sync/tasks.ts 的 extractTaskDeltas + applyTaskDelta 承载）。
            // 此前这里重复解析同一批 tool_use 写入 teamState.tasks，两套视图独立合并、
            // 永不校准，且会让一个纯 task 会话凭空生成 members 为空的 teamState。
            case 'SendMessage':
                delta = processSendMessage(block.input)
                break
        }

        if (delta) {
            result = result ? mergeDelta(result, delta) : delta
        }
    }

    return result
}

function mergeDelta(base: TeamStateDelta, incoming: TeamStateDelta): TeamStateDelta {
    // delete action overrides everything
    if (incoming._action === 'delete') return incoming
    // create action overrides everything
    if (incoming._action === 'create') return incoming

    const merged = { ...base }

    if (incoming.members) {
        merged.members = [...(merged.members ?? []), ...incoming.members]
    }
    if (incoming.tasks) {
        merged.tasks = [...(merged.tasks ?? []), ...incoming.tasks]
    }
    if (incoming.messages) {
        merged.messages = [...(merged.messages ?? []), ...incoming.messages]
    }
    if (incoming.updatedAt) {
        merged.updatedAt = incoming.updatedAt
    }

    return merged
}

/**
 * 从 system message 中提取 team 相关增量（task_started/task_progress）。
 * 仅当 session 有活跃 teamState 时才产生 delta。
 */
export function extractTeamSystemDeltasFromMessageContent(
    messageContent: unknown,
    existingTeamState: TeamState | null | undefined,
): TeamStateDelta | null {
    if (!existingTeamState) return null

    // 解包骨架收口在 unwrapOutputMessage（shared/messages）；此处只关心 system 消息
    const unwrapped = unwrapOutputMessage(messageContent)
    if (!unwrapped) return null
    if (unwrapped.role !== 'agent') return null

    const data = unwrapped.data.type === 'system' ? unwrapped.data : null
    if (!data) return null

    const subtype = typeof data.subtype === 'string' ? data.subtype : null

    // task_started: 关联 task_id 到对应 teammate
    if (subtype === 'task_started') {
        const taskType = typeof data.task_type === 'string' ? data.task_type : null
        if (taskType !== 'in_process_teammate') return null

        const taskId = typeof data.task_id === 'string' ? data.task_id : null
        if (!taskId) return null

        // SDK 按序调度 teammate，task_started 与最近一个 Agent tool_use 对应，
        // 因此取第一个 running/active 的 member 是正确的
        const member = existingTeamState.members?.find(m =>
            m.status === 'running' || m.status === 'active'
        )
        if (!member) return null

        const existingTaskIds = member.taskIds ?? []

        return {
            _action: 'update',
            members: [{
                name: member.name,
                taskIds: [...existingTaskIds, taskId],
            }],
            updatedAt: Date.now()
        }
    }

    // task_progress: 更新 teammate 的 lastProgressAt
    if (subtype === 'task_progress') {
        const taskId = typeof data.task_id === 'string' ? data.task_id : null
        if (!taskId) return null

        // 找到拥有此 taskId 的 member
        const member = existingTeamState.members?.find(m =>
            m.taskIds?.includes(taskId)
        )
        if (!member) return null

        return {
            _action: 'update',
            members: [{
                name: member.name,
                lastProgressAt: Date.now(),
            }],
            updatedAt: Date.now()
        }
    }

    return null
}

/**
 * 从 user 消息的 tool_result 中提取 teammate 完成增量（pending #11/#44）。
 *
 * teammate 生命周期此前只有入口（Agent tool_use 注册 member）没有出口——
 * `status: 'running'` 永远不会被翻成终态，导致已完成的 teammate 条目
 * 永挂在 teamState（自动清理形同虚设）。而 Agent 工具的 tool_result
 * 本来就在消息流里：它到达即意味着该 teammate 已跑完，据此配对
 * member.toolUseIds 标记 completed，由 applyTeamStateDelta 既有的
 * all-done 自动清理接管清空。
 *
 * 对应 task（`agent:${name}`）同步翻 completed——否则 allTasksDone
 * 不满足、自动清理不触发。失败（is_error）的 tool_result 同样算完成：
 * 失败的 teammate 也要退出，避免永挂。
 */
export function extractTeamMemberCompletionFromMessageContent(
    messageContent: unknown,
    existingTeamState: TeamState | null | undefined,
): TeamStateDelta | null {
    if (!existingTeamState) return null

    // 解包骨架收口在 unwrapOutputMessage（shared/messages）。
    // tool_result 挂在 data.type='user' 的消息（assistant 的 tool_use → user 的 tool_result），
    // 真实消息类型看 data.type——对齐 sync/tasks.ts 的判定方式
    const unwrapped = unwrapOutputMessage(messageContent)
    if (!unwrapped || unwrapped.data.type !== 'user') return null

    const completedNames = new Set<string>()
    for (const block of unwrapped.blocks ?? []) {
        if (!isObject(block) || block.type !== 'tool_result') continue
        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
        if (!toolUseId) continue
        for (const member of existingTeamState.members ?? []) {
            // 已终态的 member 幂等跳过
            if (member.status && member.status !== 'running' && member.status !== 'active') continue
            if (member.toolUseIds?.includes(toolUseId)) {
                completedNames.add(member.name)
            }
        }
    }
    if (completedNames.size === 0) return null

    // 对应 task 同步翻 completed（仅未终态的；title 供 applyTeamStateDelta 插入分支用）
    const completedTasks = (existingTeamState.tasks ?? [])
        .filter(t => completedNames.has(t.owner ?? '') && t.status !== 'completed' && t.status !== 'deleted')
        .map(t => ({ id: t.id, title: t.title, status: 'completed' as const, owner: t.owner }))

    return {
        _action: 'update',
        members: Array.from(completedNames, name => ({ name, status: 'completed' as const })),
        ...(completedTasks.length > 0 ? { tasks: completedTasks } : {}),
        updatedAt: Date.now()
    }
}

/**
 * Session 结束时，标记所有 members 为 completed，所有 tasks 为 completed。
 */
export function handleTeamSessionEnd(existingTeamState: TeamState | null | undefined): TeamState | null {
    if (!existingTeamState) return null

    return {
        ...existingTeamState,
        members: existingTeamState.members?.map(m => ({
            ...m,
            status: 'completed' as const,
        })),
        tasks: existingTeamState.tasks?.map(t => ({
            ...t,
            status: 'completed' as const,
        })),
        updatedAt: Date.now(),
    }
}

/**
 * 从 mobi sessionId 推导隐式团队名：`session-` + 前 8 位。
 *
 * SDK v2.1.178+ 不再有 TeamCreate，团队名不会随消息到达，只能本地推导。
 * 命名形式借用 Claude Code 的习惯，但取的是 mobi sessionId（非 claude sessionId），
 * 因此与 `~/.claude/teams/{team-name}/` 下的实际目录名并不对应——
 * 此值仅用于前端展示与 task 的 `_teamName` 归属标记，不用于寻址任何文件。
 */
function deriveTeamName(sessionId?: string): string {
    if (!sessionId) return ''
    return `session-${sessionId.slice(0, 8)}`
}

export function applyTeamStateDelta(
    existing: TeamState | null | undefined,
    delta: TeamStateDelta,
    sessionId?: string
): TeamState | null {
    if (delta._action === 'delete') return null

    if (delta._action === 'create') {
        const { _action: _, ...state } = delta
        return state as TeamState
    }

    // update: merge into existing
    // 如果 existing 为 null（自动清理后或首次 update），从 delta 隐式重建
    if (!existing) {
        if (!delta.members && !delta.tasks) return null
        return {
            // delta 自带 teamName（如 session 结束时整体回灌）优先，其次按 sessionId 推导
            teamName: delta.teamName ?? deriveTeamName(sessionId),
            members: delta.members ?? [],
            tasks: delta.tasks ?? [],
            messages: delta.messages ?? [],
            updatedAt: delta.updatedAt ?? Date.now(),
        }
    }

    const updated = { ...existing }

    if (delta.members) {
        const memberMap = new Map((updated.members ?? []).map(m => [m.name, m]))
        for (const member of delta.members) {
            const existing = memberMap.get(member.name)
            if (existing) {
                memberMap.set(member.name, { ...existing, ...member })
            } else {
                memberMap.set(member.name, member)
            }
        }
        updated.members = Array.from(memberMap.values())
    }

    if (delta.tasks) {
        const taskMap = new Map((updated.tasks ?? []).map(t => [t.id, t]))
        for (const task of delta.tasks) {
            const existing = taskMap.get(task.id)
            if (existing) {
                taskMap.set(task.id, { ...existing, ...task })
            } else if (task.title) {
                // Only insert new tasks that have a title (required by schema).
                // Orphan TaskUpdate without title is ignored to prevent schema validation failure.
                taskMap.set(task.id, task)
            }
        }
        updated.tasks = Array.from(taskMap.values())
    }

    if (delta.messages) {
        const msgs = updated.messages ?? []
        updated.messages = [...msgs, ...delta.messages].slice(-50)
    }

    if (delta.updatedAt) {
        updated.updatedAt = delta.updatedAt
    }

    // 自动清理：所有 members 都不在运行 + 所有 tasks 都已完成
    const allMembersDone = !updated.members || updated.members.length === 0 ||
        updated.members.every(m =>
            m.status === 'idle' || m.status === 'shutdown' || m.status === 'completed'
        )
    const allTasksDone = !updated.tasks || updated.tasks.length === 0 ||
        updated.tasks.every(t => t.status === 'completed' || t.status === 'deleted')
    if (allMembersDone && allTasksDone) return null

    return updated
}
