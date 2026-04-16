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
    getSessionGroups as getSessionGroupsFromDb,
    getSessionsByGroup as getSessionsByGroupFromDb,
    setRuntimeState,
    updateSessionAgentState,
    updateSessionMetadata,
    type SessionGroup,
    type GroupSessionsResult
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace)
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

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByClaudeSessionId(claudeSessionId: string, namespace: string): StoredSession | null {
        return getSessionByClaudeSessionId(this.db, claudeSessionId, namespace)
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

    // ============ 分组相关 ============

    getSessionGroups(namespace: string): SessionGroup[] {
        return getSessionGroupsFromDb(this.db, namespace)
    }

    getSessionsByGroup(
        namespace: string,
        groupKey: string,
        cursor: number | null,
        limit?: number
    ): GroupSessionsResult {
        return getSessionsByGroupFromDb(this.db, namespace, groupKey, cursor, limit)
    }
}
