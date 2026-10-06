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
    WorkspaceFolderSchema, WorkspaceSchema, SessionSchema, MetadataSchema,
    validateWorkspaceFolders, WORKSPACE_FOLDERS_ERROR_MESSAGES,
} from '../src/schemas'

describe('WorkspaceFolderSchema', () => {
    it('接受 path + primary', () => {
        expect(WorkspaceFolderSchema.parse({ path: '/a/mobi', primary: true })).toEqual({
            path: '/a/mobi', primary: true,
        })
    })
    it('缺 primary 失败', () => {
        expect(WorkspaceFolderSchema.safeParse({ path: '/a' }).success).toBe(false)
    })
})

describe('validateWorkspaceFolders', () => {
    it('空数组报错', () => {
        expect(validateWorkspaceFolders([])).toBe('empty')
    })
    it('无 primary 报错', () => {
        expect(validateWorkspaceFolders([{ path: '/a', primary: false }])).toBe('no_primary')
    })
    it('多个 primary 报错', () => {
        expect(validateWorkspaceFolders([
            { path: '/a', primary: true }, { path: '/b', primary: true },
        ])).toBe('multi_primary')
    })
    it('path 为空串 / 纯空白报错（空文件夹曾可建出工作区的根因）', () => {
        expect(validateWorkspaceFolders([{ path: '', primary: true }])).toBe('empty_path')
        expect(validateWorkspaceFolders([
            { path: '/a', primary: true }, { path: '  ', primary: false },
        ])).toBe('empty_path')
    })
    it('合法列表返回 null', () => {
        expect(validateWorkspaceFolders([
            { path: '/a', primary: true }, { path: '/b', primary: false },
        ])).toBeNull()
    })
    it('WORKSPACE_FOLDERS_ERROR_MESSAGES 覆盖全部错误码（hub 400 文案来源）', () => {
        for (const message of Object.values(WORKSPACE_FOLDERS_ERROR_MESSAGES)) {
            expect(typeof message).toBe('string')
            expect(message.length).toBeGreaterThan(0)
        }
    })
})

describe('WorkspaceSchema', () => {
    const base = {
        id: 'p1', namespace: 'default', machineId: 'm1', name: 'mobi',
        createdAt: 1, updatedAt: 1, seq: 0,
    }
    it('接受完整对象', () => {
        expect(WorkspaceSchema.safeParse({ ...base, folders: [{ path: '/a/mobi', primary: true }] }).success).toBe(true)
    })
    it('machineId 可缺省（402 起过渡 optional，404 彻底删）', () => {
        const { id, namespace, name, createdAt, updatedAt, seq } = base
        const withoutMachine = {
            id, namespace, name, createdAt, updatedAt, seq,
            folders: [{ path: '/a', primary: true }],
        }
        expect(WorkspaceSchema.safeParse(withoutMachine).success).toBe(true)
        expect(WorkspaceSchema.safeParse({ ...withoutMachine, machineId: 'm1' }).success).toBe(true)
    })
})

describe('SessionSchema/MetadataSchema 扩展', () => {
    const sessionBase = {
        id: 's1', namespace: 'default', seq: 0, createdAt: 1, updatedAt: 1,
        active: false, activeAt: 0, metadata: null, metadataVersion: 1,
        agentState: null, agentStateVersion: 1, running: false, runningAt: 0,
    }
    it('SessionSchema 接受 workspaceId（可空可缺省）', () => {
        expect(SessionSchema.safeParse(sessionBase).success).toBe(true)
        expect(SessionSchema.safeParse({ ...sessionBase, workspaceId: null }).success).toBe(true)
    })
    it('SessionSchema 解析后携带 workspaceId（缺省为 undefined）', () => {
        expect(SessionSchema.parse({ ...sessionBase, workspaceId: 'p1' }).workspaceId).toBe('p1')
        expect(SessionSchema.parse(sessionBase).workspaceId).toBeUndefined()
    })
    it('SessionSchema 拒绝非字符串 workspaceId', () => {
        expect(SessionSchema.safeParse({ ...sessionBase, workspaceId: 123 }).success).toBe(false)
    })
    it('MetadataSchema 解析后携带 additionalDirectories', () => {
        const base = { path: '/a', host: 'h' }
        expect(MetadataSchema.parse({ ...base, additionalDirectories: ['/b'] }).additionalDirectories).toEqual(['/b'])
    })
    it('MetadataSchema 拒绝非数组 additionalDirectories', () => {
        expect(MetadataSchema.safeParse({ path: '/a', host: 'h', additionalDirectories: '/b' }).success).toBe(false)
    })
})
