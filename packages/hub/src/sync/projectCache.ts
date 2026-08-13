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

import type { Project, ProjectFolder } from '@mobi/shared'
import type { Store } from '../store'
import { EventPublisher } from './eventPublisher'

/**
 * 项目缓存：内存 Map + EventPublisher，镜像 sessionCache/machineCache 范式。
 *
 * SSE 联动语义：
 * - CRUD 后广播 project-added/updated/removed（事件必须带 namespace——
 *   EventPublisher.resolveNamespace 不认 projectId，无缓存回查，shared schema 强制必填）
 * - deleteProject 前 store 会把名下会话解绑（project_id → NULL），删除成功后逐个广播
 *   session-updated，让 Web 感知会话流入「最近」
 */
export class ProjectCache {
    /** 项目缓存：projectId -> Project */
    private readonly projects: Map<string, Project> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    getProjects(namespace: string): Project[] {
        return Array.from(this.projects.values())
            .filter(p => p.namespace === namespace)
            .sort((a, b) => b.updatedAt - a.updatedAt || b.seq - a.seq)
    }

    getProject(id: string): Project | undefined {
        // 读穿透：缓存未命中（如 warmup 未覆盖、外部写入）时回源 DB，避免路由层恒 undefined
        return this.projects.get(id) ?? this.store.projects.getProject(id) ?? undefined
    }

    createProject(namespace: string, input: { machineId: string; name: string; folders: ProjectFolder[] }): Project {
        // folders 非法（0 项 / 双 primary）由 store 层 validateProjectFolders 抛错
        const project = this.store.projects.createProject({ namespace, ...input })
        this.projects.set(project.id, project)
        this.publisher.emit({ type: 'project-added', projectId: project.id, namespace })
        return project
    }

    updateProject(id: string, namespace: string, patch: { name?: string; folders?: ProjectFolder[] }): Project | null {
        const updated = this.store.projects.updateProject(id, namespace, patch)
        if (updated) {
            this.projects.set(id, updated)
            this.publisher.emit({ type: 'project-updated', projectId: id, namespace })
        }
        return updated
    }

    deleteProject(id: string, namespace: string): boolean {
        // 快照名下会话：store 删除事务内会把它们解绑（project_id → NULL），
        // 删除成功后需逐个广播 session-updated，Web 端才能感知会话流入「最近」
        const affectedSessionIds = this.store.sessions.getSessionsByNamespace(namespace)
            .filter(s => s.projectId === id)
            .map(s => s.id)

        const ok = this.store.projects.deleteProject(id, namespace)
        if (!ok) return false

        this.projects.delete(id)
        this.publisher.emit({ type: 'project-removed', projectId: id, namespace })
        for (const sessionId of affectedSessionIds) {
            this.publisher.emit({ type: 'session-updated', sessionId, namespace })
        }
        return true
    }

    warmupCache(): void {
        this.projects.clear()
        // 全 namespace 加载（项目量小），镜像 machineCache.warmupCache 的全量语义
        for (const project of this.store.projects.getAllProjects()) {
            this.projects.set(project.id, project)
        }
    }
}
