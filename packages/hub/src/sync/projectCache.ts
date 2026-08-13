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
        // 列表排序依赖「组内会话最新活动」（sessions.updated_at 派生），会话活动不经过本缓存、
        // 内存无法跟踪——故列表每次委托 store SQL 排序（projects 表极小，代价可忽略），
        // 顺带回填缓存保持身份查找新鲜；getProject 单查仍走内存
        const ordered = this.store.projects.getProjects(namespace)
        for (const project of ordered) {
            this.projects.set(project.id, project)
        }
        return ordered
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

    /**
     * 删除项目（store 事务内解绑名下会话，project_id → NULL）。
     * 删除成功返回受影响的 session ID 列表（事务内枚举，无「先查后删」竞态窗口），
     * 失败返回 null——调用方（syncEngine）据此刻意刷新 sessionCache 对应条目，
     * 无需全 namespace 扫描。
     */
    deleteProject(id: string, namespace: string): string[] | null {
        const affectedSessionIds = this.store.projects.deleteProject(id, namespace)
        if (affectedSessionIds === false) return null

        this.projects.delete(id)
        this.publisher.emit({ type: 'project-removed', projectId: id, namespace })
        // 名下会话已解绑（流入「最近」），逐个广播让 Web 端感知
        for (const sessionId of affectedSessionIds) {
            this.publisher.emit({ type: 'session-updated', sessionId, namespace })
        }
        return affectedSessionIds
    }

    warmupCache(): void {
        this.projects.clear()
        // 全 namespace 加载（项目量小），镜像 machineCache.warmupCache 的全量语义
        for (const project of this.store.projects.getAllProjects()) {
            this.projects.set(project.id, project)
        }
    }
}
