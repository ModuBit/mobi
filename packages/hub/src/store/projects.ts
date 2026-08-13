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

import { validateProjectFolders, type ProjectFolder } from '@mobi/shared'

import { safeJsonParse } from './json'
import type { StoredProject } from './types'

type DbProjectRow = {
    id: string
    namespace: string
    machine_id: string
    name: string
    folders: string
    created_at: number
    updated_at: number
    seq: number
}

function toProject(row: DbProjectRow): StoredProject {
    return {
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        name: row.name,
        folders: (safeJsonParse(row.folders) as ProjectFolder[]) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        seq: row.seq
    }
}

export function getProjects(db: Database, namespace: string): StoredProject[] {
    // 排序沿用旧虚拟分组的「最近会话活动浮顶」心智模型：组内会话最新 updated_at 优先，
    // 无会话（新建/空项目）回退实体编辑时间；seq 作同毫秒 tie-breaker
    const rows = db.prepare(`
        SELECT p.*,
               (SELECT MAX(s.updated_at) FROM sessions s WHERE s.project_id = p.id) AS last_active_at
        FROM projects p
        WHERE p.namespace = ?
        ORDER BY COALESCE(last_active_at, p.updated_at) DESC, p.seq DESC
    `).all(namespace) as (DbProjectRow & { last_active_at: number | null })[]
    return rows.map(toProject)
}

/** 跨 namespace 全量项目（缓存 warmup 用，镜像 machines.getMachines 的全量语义） */
export function getAllProjects(db: Database): StoredProject[] {
    const rows = db.prepare(
        'SELECT * FROM projects ORDER BY updated_at DESC, seq DESC'
    ).all() as DbProjectRow[]
    return rows.map(toProject)
}

export function getProject(db: Database, id: string): StoredProject | null {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as DbProjectRow | undefined
    return row ? toProject(row) : null
}

export function createProject(
    db: Database,
    input: { namespace: string; machineId: string; name: string; folders: ProjectFolder[] }
): StoredProject {
    const error = validateProjectFolders(input.folders)
    if (error) throw new Error(error)

    const now = Date.now()
    const row: DbProjectRow = {
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
        INSERT INTO projects (id, namespace, machine_id, name, folders, created_at, updated_at, seq)
        VALUES (@id, @namespace, @machine_id, @name, @folders, @created_at, @updated_at, 0)
    `).run(row)
    return toProject(row)
}

export function updateProject(
    db: Database,
    id: string,
    namespace: string,
    patch: { name?: string; folders?: ProjectFolder[] }
): StoredProject | null {
    // 先做存在性与 namespace 归属检查：不存在的项目直接返回 null，不触发校验抛错
    const existing = getProject(db, id)
    if (!existing || existing.namespace !== namespace) return null

    if (patch.folders) {
        const error = validateProjectFolders(patch.folders)
        if (error) throw new Error(error)
    }

    const now = Date.now()
    db.prepare(`
        UPDATE projects
        SET name = @name, folders = @folders, updated_at = @updated_at, seq = seq + 1
        WHERE id = @id AND namespace = @namespace
    `).run({
        id,
        namespace,
        name: patch.name ?? existing.name,
        folders: JSON.stringify(patch.folders ?? existing.folders),
        updated_at: now
    })
    return getProject(db, id)
}

/** 删除项目：同事务内将名下 sessions 解绑（project_id 置 NULL），会话本身不删 */
export function deleteProject(db: Database, id: string, namespace: string): boolean {
    const existing = getProject(db, id)
    if (!existing || existing.namespace !== namespace) return false

    db.transaction(() => {
        // 解绑也遵循 sessions 变更范式：成对递增 updated_at/seq，SSE 增量同步才能感知
        db.prepare(`
            UPDATE sessions
            SET project_id = NULL, updated_at = @now, seq = seq + 1
            WHERE project_id = @id
        `).run({ id, now: Date.now() })
        db.prepare('DELETE FROM projects WHERE id = ? AND namespace = ?').run(id, namespace)
    })()
    return true
}
