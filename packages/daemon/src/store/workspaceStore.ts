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

import type { WorkspaceFolder } from '@mobi/shared'

import type { StoredWorkspace } from './types'
import { createWorkspace, deleteWorkspace, getAllWorkspaces, getWorkspace, getWorkspaces, updateWorkspace } from './workspaces'

/** 工作区存储薄包装：与 SessionStore 等保持一致的 db 注入形态 */
export class WorkspaceStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getWorkspaces(namespace: string): StoredWorkspace[] {
        return getWorkspaces(this.db, namespace)
    }

    getWorkspace(id: string): StoredWorkspace | null {
        return getWorkspace(this.db, id)
    }

    /** 跨 namespace 全量工作区（缓存 warmup 用） */
    getAllWorkspaces(): StoredWorkspace[] {
        return getAllWorkspaces(this.db)
    }

    createWorkspace(input: {
        namespace: string
        name: string
        folders: WorkspaceFolder[]
    }): StoredWorkspace {
        return createWorkspace(this.db, input)
    }

    updateWorkspace(
        id: string,
        namespace: string,
        patch: { name?: string; folders?: WorkspaceFolder[] }
    ): StoredWorkspace | null {
        return updateWorkspace(this.db, id, namespace, patch)
    }

    /** 删除工作区并解绑名下会话（事务内）；返回受影响 session id 列表，失败 false */
    deleteWorkspace(id: string, namespace: string): string[] | false {
        return deleteWorkspace(this.db, id, namespace)
    }
}
