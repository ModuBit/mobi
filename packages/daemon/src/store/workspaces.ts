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

import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { validateWorkspaceFolders, WORKSPACE_FOLDERS_ERROR_MESSAGES, type WorkspaceFolder } from '@mobi/shared'

import { safeJsonParse } from './json'
import type { StoredWorkspace } from './types'

type DbWorkspaceRow = {
    id: string
    namespace: string
    machine_id: string
    name: string
    folders: string
    created_at: number
    updated_at: number
    seq: number
}

function toWorkspace(row: DbWorkspaceRow): StoredWorkspace {
    return {
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        name: row.name,
        folders: (safeJsonParse(row.folders) as WorkspaceFolder[]) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        seq: row.seq
    }
}

export function getWorkspaces(db: Database, namespace: string): StoredWorkspace[] {
    // 排序沿用旧虚拟分组的「最近会话活动浮顶」心智模型：组内会话最新 updated_at 优先，
    // 无会话（新建/空工作区）回退实体编辑时间；seq 作同毫秒 tie-breaker
    const rows = db.prepare(`
        SELECT p.*,
               (SELECT MAX(s.updated_at) FROM sessions s WHERE s.workspace_id = p.id) AS last_active_at
        FROM workspaces p
        WHERE p.namespace = ?
        ORDER BY COALESCE(last_active_at, p.updated_at) DESC, p.seq DESC
    `).all(namespace) as (DbWorkspaceRow & { last_active_at: number | null })[]
    return rows.map(toWorkspace)
}

/** 跨 namespace 全量工作区（缓存 warmup 用，镜像 machines.getMachines 的全量语义） */
export function getAllWorkspaces(db: Database): StoredWorkspace[] {
    const rows = db.prepare(
        'SELECT * FROM workspaces ORDER BY updated_at DESC, seq DESC'
    ).all() as DbWorkspaceRow[]
    return rows.map(toWorkspace)
}

export function getWorkspace(db: Database, id: string): StoredWorkspace | null {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as DbWorkspaceRow | undefined
    return row ? toWorkspace(row) : null
}

export function createWorkspace(
    db: Database,
    input: { namespace: string; machineId: string; name: string; folders: WorkspaceFolder[] }
): StoredWorkspace {
    const error = validateWorkspaceFolders(input.folders)
    if (error) throw new Error(WORKSPACE_FOLDERS_ERROR_MESSAGES[error])

    const now = Date.now()
    const row: DbWorkspaceRow = {
        id: randomUUID(),
        namespace: input.namespace,
        machine_id: input.machineId,
        name: input.name,
        folders: JSON.stringify(input.folders),
        created_at: now,
        updated_at: now,
        seq: 0
    }
    db.prepare(`
        INSERT INTO workspaces (id, namespace, machine_id, name, folders, created_at, updated_at, seq)
        VALUES (@id, @namespace, @machine_id, @name, @folders, @created_at, @updated_at, 0)
    `).run(row)
    return toWorkspace(row)
}

export function updateWorkspace(
    db: Database,
    id: string,
    namespace: string,
    patch: { name?: string; folders?: WorkspaceFolder[] }
): StoredWorkspace | null {
    // 先做存在性与 namespace 归属检查：不存在的工作区直接返回 null，不触发校验抛错
    const existing = getWorkspace(db, id)
    if (!existing || existing.namespace !== namespace) return null

    if (patch.folders) {
        const error = validateWorkspaceFolders(patch.folders)
        if (error) throw new Error(WORKSPACE_FOLDERS_ERROR_MESSAGES[error])
    }

    const now = Date.now()
    db.prepare(`
        UPDATE workspaces
        SET name = @name, folders = @folders, updated_at = @updated_at, seq = seq + 1
        WHERE id = @id AND namespace = @namespace
    `).run({
        id,
        namespace,
        name: patch.name ?? existing.name,
        folders: JSON.stringify(patch.folders ?? existing.folders),
        updated_at: now
    })
    return getWorkspace(db, id)
}

/**
 * 删除工作区：同事务内将名下 sessions 解绑（workspace_id 置 NULL），会话本身不删。
 * 返回受影响的 session id 列表（调用方据此广播/刷新缓存）；工作区不存在或跨 namespace
 * 时返回 false。枚举与解绑放在同一事务里，消除「先查后删」间隙内新归入会话解绑了
 * 却不在返回列表的竞态；只取 id（走 idx_sessions_workspace），调用方无需再全量扫描
 */
export function deleteWorkspace(db: Database, id: string, namespace: string): string[] | false {
    const existing = getWorkspace(db, id)
    if (!existing || existing.namespace !== namespace) return false

    return db.transaction(() => {
        const affectedIds = (db.prepare(
            'SELECT id FROM sessions WHERE workspace_id = ?'
        ).all(id) as Array<{ id: string }>).map(row => row.id)
        // 解绑也遵循 sessions 变更范式：成对递增 updated_at/seq，SSE 增量同步才能感知
        db.prepare(`
            UPDATE sessions
            SET workspace_id = NULL, updated_at = @now, seq = seq + 1
            WHERE workspace_id = @id
        `).run({ id, now: Date.now() })
        db.prepare('DELETE FROM workspaces WHERE id = ? AND namespace = ?').run(id, namespace)
        return affectedIds
    })()
}
