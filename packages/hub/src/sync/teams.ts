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
    const description = typeof input.description === 'string' ? input.description : null

    const delta: TeamStateDelta = {
        _action: 'update',
        members: [{ name, agentType, status: 'active' }],
        updatedAt: Date.now()
    }

    // Also track the spawned agent's work as a task
    if (description) {
        delta.tasks = [{
            id: `agent:${name}`,
            title: description,
            status: 'in_progress',
            owner: name
        }]
    }

    return delta
}

function processTaskCreate(input: Record<string, unknown>): TeamStateDelta | null {
    const id = typeof input.task_id === 'string' ? input.task_id
        : typeof input.id === 'string' ? input.id
        : null
    const title = typeof input.title === 'string' ? input.title
        : typeof input.content === 'string' ? input.content
        : null
    if (!id || !title) return null

    const description = typeof input.description === 'string' ? input.description : undefined
    const status = typeof input.status === 'string' ? input.status as 'pending' | 'in_progress' | 'completed' | 'blocked' : 'pending'
    const owner = typeof input.owner === 'string' ? input.owner : undefined

    return {
        _action: 'update',
        tasks: [{ id, title, description, status, owner }],
        updatedAt: Date.now()
    }
}

function processTaskUpdate(input: Record<string, unknown>): TeamStateDelta | null {
    const id = typeof input.task_id === 'string' ? input.task_id
        : typeof input.id === 'string' ? input.id
        : null
    if (!id) return null

    const task: Record<string, unknown> = { id }
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

/** 处理 TeammateIdle hook 事件，更新 member 状态为 idle */
function processTeammateIdle(input: Record<string, unknown>): TeamStateDelta | null {
    const teammateName = typeof input.teammate_name === 'string' ? input.teammate_name : null
    if (!teammateName) return null
    return {
        _action: 'update',
        members: [{ name: teammateName, status: 'idle' }],
        updatedAt: Date.now(),
    }
}

/** 处理 TaskCompleted hook 事件，更新 task 状态为 completed */
function processTaskCompleted(input: Record<string, unknown>): TeamStateDelta | null {
    const taskId = typeof input.task_id === 'string' ? input.task_id : null
    if (!taskId) return null
    return {
        _action: 'update',
        tasks: [{
            id: taskId,
            title: typeof input.task_subject === 'string' ? input.task_subject : '',
            status: 'completed',
            owner: typeof input.teammate_name === 'string' ? input.teammate_name : undefined,
        }],
        updatedAt: Date.now(),
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

    // 处理 hook_started 事件（TeammateIdle、TaskCompleted 等）
    if (record.content.type === 'output') {
        const data = isObject(record.content.data) ? record.content.data : null
        if (data && data.type === 'hook_started') {
            const hookEventName = typeof data.hook_event_name === 'string' ? data.hook_event_name : null
            const hookInput = isObject(data.input) ? data.input as Record<string, unknown> : null

            if (hookEventName === 'TeammateIdle' && hookInput) {
                return processTeammateIdle(hookInput)
            }
            if (hookEventName === 'TaskCompleted' && hookInput && hookInput.team_name) {
                return processTaskCompleted(hookInput)
            }
            // 其他 hook_started 事件忽略
            return null
        }
    }

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
    if (!existing) return null

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

    // 自动清理：所有 members 都 idle/shutdown + 所有 tasks 都 completed → 删除 teamState
    const allMembersDone = !updated.members || updated.members.length === 0 ||
        updated.members.every(m => m.status === 'idle' || m.status === 'shutdown')
    const allTasksDone = !updated.tasks || updated.tasks.length === 0 ||
        updated.tasks.every(t => t.status === 'completed')
    if (allMembersDone && allTasksDone) return null

    return updated
}
