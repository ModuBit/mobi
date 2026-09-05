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

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    deleteSession,
    getOrCreateSession,
    getSession,
    getSessionByClaudeSessionId,
    getSessionByNamespace,
    getSessions,
    getRecentSessions,
    getSessionsByNamespace,
    getSessionsByProject as getSessionsByProjectFromDb,
    getUnboundSessions as getUnboundSessionsFromDb,
    setSessionProject as setSessionProjectFromDb,
    getPinnedSessions as getPinnedSessionsFromDb,
    setSessionPinned as setSessionPinnedFromDb,
    setRuntimeState,
    clearRuntimeStateFields,
    mergeRuntimeState,
    updateSessionAgentState,
    updateSessionMetadata,
    type ProjectSessionsResult,
    type SetSessionProjectResult,
    type SetSessionPinnedResult
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        runtimeState?: unknown,
        projectId?: string | null
    ): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, runtimeState, projectId)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
    }

    /**
     * 设置运行时状态（合并了 todos、teamState、model 等扩展状态）
     */
    setRuntimeState(id: string, runtimeState: unknown, updatedAt: number, namespace: string): boolean {
        return setRuntimeState(this.db, id, runtimeState, updatedAt, namespace)
    }

    /**
     * 清除 runtimeState 中的指定字段
     */
    clearRuntimeStateFields(id: string, fields: string[], namespace: string): boolean {
        return clearRuntimeStateFields(this.db, id, fields, namespace)
    }

    /**
     * runtime_state 字段级合并写（读 DB 最新 → patch 合并 → 写回，同步原子）。
     * patch 值 undefined = 清除该字段；返回 null = 会话不存在/写库失败
     */
    mergeRuntimeState(
        id: string,
        patch: Record<string, unknown>,
        updatedAt: number,
        namespace: string
    ): { merged: Record<string, unknown>; changed: boolean } | null {
        return mergeRuntimeState(this.db, id, patch, updatedAt, namespace)
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByClaudeSessionId(nativeSessionId: string, namespace: string): StoredSession | null {
        return getSessionByClaudeSessionId(this.db, nativeSessionId, namespace)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessions(): StoredSession[] {
        return getSessions(this.db)
    }

    getRecentSessions(limit: number): StoredSession[] {
        return getRecentSessions(this.db, limit)
    }

    getSessionsByNamespace(namespace: string): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace)
    }

    deleteSession(id: string, namespace: string): boolean {
        return deleteSession(this.db, id, namespace)
    }

    // ============ 项目归属相关 ============

    getSessionsByProject(
        namespace: string,
        projectId: string,
        cursor: number | null,
        limit?: number
    ): ProjectSessionsResult {
        return getSessionsByProjectFromDb(this.db, namespace, projectId, cursor, limit)
    }

    getUnboundSessions(
        namespace: string,
        cursor: number | null,
        limit?: number
    ): ProjectSessionsResult {
        return getUnboundSessionsFromDb(this.db, namespace, cursor, limit)
    }

    setSessionProject(id: string, projectId: string | null, namespace: string): SetSessionProjectResult {
        return setSessionProjectFromDb(this.db, id, projectId, namespace)
    }

    // ============ 置顶相关 ============

    getPinnedSessions(
        namespace: string,
        cursor: number | null,
        limit?: number
    ): ProjectSessionsResult {
        return getPinnedSessionsFromDb(this.db, namespace, cursor, limit)
    }

    setSessionPinned(id: string, pinned: boolean, namespace: string): SetSessionPinnedResult {
        return setSessionPinnedFromDb(this.db, id, pinned, namespace)
    }
}
