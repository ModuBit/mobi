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

import type { ProjectFolder } from '@mobi/shared'

import type { StoredProject } from './projects'
import { createProject, deleteProject, getProject, getProjects, updateProject } from './projects'

/** 项目存储薄包装：与 SessionStore 等保持一致的 db 注入形态 */
export class ProjectStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getProjects(namespace: string): StoredProject[] {
        return getProjects(this.db, namespace)
    }

    getProject(id: string): StoredProject | null {
        return getProject(this.db, id)
    }

    createProject(input: {
        namespace: string
        machineId: string
        name: string
        folders: ProjectFolder[]
    }): StoredProject {
        return createProject(this.db, input)
    }

    updateProject(
        id: string,
        namespace: string,
        patch: { name?: string; folders?: ProjectFolder[] }
    ): StoredProject | null {
        return updateProject(this.db, id, namespace, patch)
    }

    deleteProject(id: string, namespace: string): boolean {
        return deleteProject(this.db, id, namespace)
    }
}
