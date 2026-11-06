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
    isNativeSessionIdBoundElsewhere,
    getSessionByNamespace,
    getSessions,
    getRecentSessions,
    getSessionsByNamespace,
    getSessionsByWorkspace as getSessionsByWorkspaceFromDb,
    getUnboundSessions as getUnboundSessionsFromDb,
    setSessionWorkspace as setSessionWorkspaceFromDb,
    getPinnedSessions as getPinnedSessionsFromDb,
    setSessionPinned as setSessionPinnedFromDb,
    setRuntimeState,
    clearRuntimeStateFields,
    type ClearRuntimeStateFieldsResult,
    markSessionEnded,
    clearSessionEnd,
    setSessionStatus,
    reconcileStartupSessionStatus,
    getArchivedSessions,
    getArchivedWorkspaceCounts,
    getArchivedSessionIds,
    addSessionTombstone,
    getSessionTombstone,
    type SessionStatusWrite,
    type SessionTombstone,
    type ArchivedWorkspaceCount,
    mergeRuntimeState,
    updateSessionAgentState,
    updateSessionMetadata,
    type WorkspaceSessionsResult,
    type SetSessionWorkspaceResult,
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
        workspaceId?: string | null
    ): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, runtimeState, workspaceId)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace)
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
    clearRuntimeStateFields(id: string, fields: string[], namespace: string): ClearRuntimeStateFieldsResult {
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

    /** 该 native 链 id 是否被另一会话绑定（删除会话处置历史 transcript 时的防误删判据） */
    isNativeSessionIdBoundElsewhere(nativeSessionId: string, exceptSessionId: string): boolean {
        return isNativeSessionIdBoundElsewhere(this.db, nativeSessionId, exceptSessionId)
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

    /** 会话终结落库（票 1.1）：endReason/pauseTrigger/endedAt 一次写入，幂等 */
    markSessionEnded(id: string, namespace: string, fields: { endReason: string; pauseTrigger?: string; endedAt: number }): boolean {
        return markSessionEnded(this.db, id, namespace, fields)
    }

    /** 会话复活（唤醒）时清终结字段 */
    clearSessionEnd(id: string, namespace: string): boolean {
        return clearSessionEnd(this.db, id, namespace)
    }

    /** 保留状态唯一写入口（status / status_updated_at / archived_at 同语句） */
    setSessionStatus(id: string, namespace: string, write: SessionStatusWrite): boolean {
        return setSessionStatus(this.db, id, namespace, write)
    }

    /** 启动自愈：宽限期后把未重连的 online 行回落 dormant，返回受影响 id */
    reconcileStartupSessionStatus(startupAt: number, now?: number): string[] {
        return reconcileStartupSessionStatus(this.db, startupAt, now)
    }

    /** 删除墓碑（惰性建表）：事后排查与 native id 复用识别 */
    addSessionTombstone(tombstone: SessionTombstone): void {
        addSessionTombstone(this.db, tombstone)
    }

    getSessionTombstone(sessionId: string): SessionTombstone | null {
        return getSessionTombstone(this.db, sessionId)
    }

    // ============ 工作区归属相关 ============

    getSessionsByWorkspace(
        namespace: string,
        workspaceId: string,
        cursor: number | null,
        limit?: number
    ): WorkspaceSessionsResult {
        return getSessionsByWorkspaceFromDb(this.db, namespace, workspaceId, cursor, limit)
    }

    getUnboundSessions(
        namespace: string,
        cursor: number | null,
        limit?: number
    ): WorkspaceSessionsResult {
        return getUnboundSessionsFromDb(this.db, namespace, cursor, limit)
    }

    /** 归档会话分页列表（归档页数据源，按归档时间倒序游标分页；项目过滤下推） */
    getArchivedSessions(namespace: string, workspaceId: string | null | undefined, cursor: number | null, limit?: number): WorkspaceSessionsResult {
        return getArchivedSessions(this.db, namespace, workspaceId, cursor, limit)
    }

    /** 归档会话按工作区的组计数（归档页组头真实总数，不受分页影响） */
    getArchivedWorkspaceCounts(namespace: string): ArchivedWorkspaceCount[] {
        return getArchivedWorkspaceCounts(this.db, namespace)
    }

    /** 归档范围批量操作的候选 id（workspaceId 三态：缺省=全部，null=未归入，string=指定） */
    getArchivedSessionIds(namespace: string, workspaceId?: string | null): string[] {
        return getArchivedSessionIds(this.db, namespace, workspaceId)
    }

    setSessionWorkspace(id: string, workspaceId: string | null, namespace: string): SetSessionWorkspaceResult {
        return setSessionWorkspaceFromDb(this.db, id, workspaceId, namespace)
    }

    // ============ 置顶相关 ============

    getPinnedSessions(
        namespace: string,
        cursor: number | null,
        limit?: number
    ): WorkspaceSessionsResult {
        return getPinnedSessionsFromDb(this.db, namespace, cursor, limit)
    }

    setSessionPinned(id: string, pinned: boolean, namespace: string): SetSessionPinnedResult {
        return setSessionPinnedFromDb(this.db, id, pinned, namespace)
    }
}
