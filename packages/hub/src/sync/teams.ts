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
import { unwrapRoleWrappedRecordEnvelope } from '@mobi/shared/messages'
import type { TeamState } from '@mobi/shared/types'

type TeamStateDelta = Partial<TeamState> & { _action?: 'create' | 'delete' | 'update' }

function extractToolBlocks(content: Record<string, unknown>): Array<{ name: string; input: Record<string, unknown> }> {
    const blocks: Array<{ name: string; input: Record<string, unknown> }> = []

    // Claude output format: { type: 'output', data: { type: 'assistant', message: { content: [...] } } }
    if (content.type === 'output') {
        const data = isObject(content.data) ? content.data : null
        if (!data || data.type !== 'assistant') return blocks

        const message = isObject(data.message) ? data.message : null
        if (!message) return blocks

        const modelContent = message.content
        if (!Array.isArray(modelContent)) return blocks

        for (const block of modelContent) {
            if (!isObject(block) || block.type !== 'tool_use') continue
            const name = typeof block.name === 'string' ? block.name : null
            if (!name) continue
            const input = isObject(block.input) ? block.input as Record<string, unknown> : null
            if (!input) continue
            blocks.push({ name, input })
        }
    }

    return blocks
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

function processTaskToolWithTeam(input: Record<string, unknown>): TeamStateDelta | null {
    const teamName = typeof input.team_name === 'string' ? input.team_name : null
    const name = typeof input.name === 'string' ? input.name : null
    if (!teamName || !name) return null

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

function processTaskCreate(input: Record<string, unknown>): TeamStateDelta | null {
    const id = typeof input.task_id === 'string' ? input.task_id
        : typeof input.id === 'string' ? input.id
        : null
    const title = typeof input.subject === 'string' ? input.subject
        : typeof input.title === 'string' ? input.title
        : typeof input.content === 'string' ? input.content
        : null
    if (!id || !title) return null

    const description = typeof input.description === 'string' ? input.description : undefined
    const status = typeof input.status === 'string' ? input.status as 'pending' | 'in_progress' | 'completed' | 'blocked' : 'pending'
    const owner = typeof input.owner === 'string' ? input.owner : undefined

    return {
        _action: 'update',
        tasks: [{ id, title, description, status, owner, createdAt: Date.now() }],
        updatedAt: Date.now()
    }
}

function processTaskUpdate(input: Record<string, unknown>): TeamStateDelta | null {
    const id = typeof input.taskId === 'string' ? input.taskId
        : typeof input.task_id === 'string' ? input.task_id
        : typeof input.id === 'string' ? input.id
        : null
    if (!id) return null

    const task: Record<string, unknown> = { id }
    if (typeof input.subject === 'string') task.title = input.subject
    if (typeof input.title === 'string') task.title = input.title
    if (typeof input.status === 'string') task.status = input.status
    if (typeof input.owner === 'string') task.owner = input.owner
    if (typeof input.description === 'string') task.description = input.description

    // Must have at least one field besides id
    if (Object.keys(task).length <= 1) return null

    return {
        _action: 'update',
        tasks: [task as { id: string; title: string; status?: 'pending' | 'in_progress' | 'completed' | 'blocked'; owner?: string }],
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
    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record) return null

    if (record.role !== 'agent' && record.role !== 'assistant') return null
    if (!isObject(record.content) || typeof record.content.type !== 'string') return null

    const blocks = extractToolBlocks(record.content)
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
                delta = processTaskToolWithTeam(block.input)
                break
            case 'TaskCreate':
                delta = processTaskCreate(block.input)
                break
            case 'TaskUpdate':
                delta = processTaskUpdate(block.input)
                break
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

    const record = unwrapRoleWrappedRecordEnvelope(messageContent)
    if (!record) return null
    if (record.role !== 'agent') return null
    if (!isObject(record.content) || record.content.type !== 'output') return null

    const data = isObject(record.content.data) ? record.content.data : null
    if (!data || data.type !== 'system') return null

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

export function applyTeamStateDelta(
    existing: TeamState | null | undefined,
    delta: TeamStateDelta
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
            teamName: '',
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
