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

import { describe, expect, it } from 'vitest'
import {
    ProjectFolderSchema, ProjectSchema, SessionSchema, MetadataSchema,
    validateProjectFolders,
} from '../src/schemas'

describe('ProjectFolderSchema', () => {
    it('接受 path + primary', () => {
        expect(ProjectFolderSchema.parse({ path: '/a/mobi', primary: true })).toEqual({
            path: '/a/mobi', primary: true,
        })
    })
})

describe('validateProjectFolders', () => {
    it('空数组报错', () => {
        expect(validateProjectFolders([])).toContain('At least one folder')
    })
    it('无 primary 报错', () => {
        expect(validateProjectFolders([{ path: '/a', primary: false }])).toContain('Exactly one primary')
    })
    it('多个 primary 报错', () => {
        expect(validateProjectFolders([
            { path: '/a', primary: true }, { path: '/b', primary: true },
        ])).toContain('Exactly one primary')
    })
    it('合法列表返回 null', () => {
        expect(validateProjectFolders([
            { path: '/a', primary: true }, { path: '/b', primary: false },
        ])).toBeNull()
    })
})

describe('ProjectSchema', () => {
    const base = {
        id: 'p1', namespace: 'default', machineId: 'm1', name: 'mobi',
        createdAt: 1, updatedAt: 1, seq: 0,
    }
    it('接受完整对象', () => {
        expect(ProjectSchema.safeParse({ ...base, folders: [{ path: '/a/mobi', primary: true }] }).success).toBe(true)
    })
    it('缺 machineId 失败', () => {
        const { id, namespace, name, createdAt, updatedAt, seq } = base
        expect(ProjectSchema.safeParse({
            id, namespace, name, createdAt, updatedAt, seq,
            folders: [{ path: '/a', primary: true }],
        }).success).toBe(false)
    })
})

describe('SessionSchema/MetadataSchema 扩展', () => {
    it('SessionSchema 接受 projectId（可空可缺省）', () => {
        const base = {
            id: 's1', namespace: 'default', seq: 0, createdAt: 1, updatedAt: 1,
            active: false, activeAt: 0, metadata: null, metadataVersion: 1,
            agentState: null, agentStateVersion: 1, running: false, runningAt: 0,
        }
        expect(SessionSchema.safeParse(base).success).toBe(true)
        expect(SessionSchema.safeParse({ ...base, projectId: 'p1' }).success).toBe(true)
        expect(SessionSchema.safeParse({ ...base, projectId: null }).success).toBe(true)
    })
    it('MetadataSchema 接受 additionalDirectories', () => {
        const base = { path: '/a', host: 'h' }
        expect(MetadataSchema.safeParse({ ...base, additionalDirectories: ['/b'] }).success).toBe(true)
    })
})
