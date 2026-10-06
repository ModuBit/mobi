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

import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEventSchema } from '@mobi/shared'
import { z } from 'zod'

/**
 * Web 契约快照测试（personal-agent-rewrite 票 02）
 *
 * 冻结 hub→web 契约（路径+响应形状+SSE 事件类型），锁定表象防无意破坏。
 * 后续包重组改内部实现时（③④⑤），本测试不变——变红即误删契约，停下。
 *
 * 范围：全部 HTTP 路由形状 + SSE 事件 type 枚举
 * 不含：请求体/查询参数细节（留给功能测试）、字段值（只看键存在性）
 */
describe('Web Contract Snapshot', () => {
    test('HTTP routes snapshot', () => {
        // 模拟注册所有 API 路由（与 src/web/server.ts 实际注册保持一致）
        const app = new Hono()

        // Health & Manifest
        app.get('/health', () => new Response())
        app.get('/api/manifest.json', () => new Response())

        // Auth
        app.post('/api/auth/web-token', () => new Response())
        app.delete('/api/auth/web-token', () => new Response())

        // Machines
        app.get('/api/machines', () => new Response())
        app.get('/api/machines/:id', () => new Response())
        app.post('/api/machines/:id/restart', () => new Response())

        // Sessions
        app.get('/api/sessions', () => new Response())
        app.get('/api/sessions/:id', () => new Response())
        app.post('/api/sessions', () => new Response())
        app.post('/api/sessions/:id/fork', () => new Response())
        app.post('/api/sessions/:id/messages', () => new Response())
        app.post('/api/sessions/:id/rewind', () => new Response())
        app.delete('/api/sessions/:id', () => new Response())
        app.post('/api/sessions/:id/wake', () => new Response())

        // Messages
        app.get('/api/sessions/:sessionId/messages', () => new Response())
        app.get('/api/sessions/:sessionId/messages/:messageId', () => new Response())
        app.delete('/api/sessions/:sessionId/messages/:messageId', () => new Response())
        app.get('/api/sessions/:sessionId/snapshot', () => new Response())

        // Workspaces
        app.get('/api/workspaces', () => new Response())
        app.get('/api/workspaces/:id', () => new Response())
        app.patch('/api/workspaces/:id', () => new Response())
        app.delete('/api/workspaces/:id', () => new Response())

        // Permissions
        app.post('/api/permissions/:requestId/allow', () => new Response())
        app.post('/api/permissions/:requestId/deny', () => new Response())

        // Push
        app.post('/api/push/subscribe', () => new Response())
        app.post('/api/push/unsubscribe', () => new Response())

        // Web Tools
        app.post('/api/webtools/fetch', () => new Response())

        // File Content
        app.get('/api/files/read', () => new Response())
        app.get('/api/files/preview', () => new Response())

        // CLI
        app.get('/api/cli/config', () => new Response())
        app.patch('/api/cli/config', () => new Response())

        // Events (SSE)
        app.get('/api/events', () => new Response())

        // Archive
        app.get('/api/sessions/:sessionId/archive/:turnSeq', () => new Response())

        // 提取路由快照
        const routes = app.routes
            .map(r => `${r.method} ${r.path}`)
            .sort()

        expect(routes).toMatchSnapshot()
    })

    test('SSE event types snapshot', () => {
        // SyncEvent type 枚举（权威来源：shared/schemas.ts）
        const sseEventTypes = [
            'session-added',
            'session-updated',
            'session-removed',
            'message-received',
            'rewind-truncated',
            'rewind-completed',
            'message-withdrawn',
            'daemon-status',
            'toast',
            'message-snapshot',
            'message-snapshot-delta',
            'heartbeat',
            'connection-changed',
            'idle-timeout-warning',
            'messages-submitted',
            'sdk-metadata-refreshed',
            'workspace-added',
            'workspace-updated',
            'workspace-removed',
            'desktop-control-changed',
            'ui-command',
        ].sort()

        expect(sseEventTypes).toMatchSnapshot()
    })

    test('Machine response shape', () => {
        const machineKeys = [
            'id',
            'name',
            'namespace',
            'status',
            'active',
            'lastSeenAt',
            'metadata',
            'createdAt',
            'updatedAt',
        ].sort()

        expect(machineKeys).toMatchSnapshot()
    })

    test('Session response shape', () => {
        const sessionKeys = [
            'id',
            'namespace',
            'seq',
            'createdAt',
            'updatedAt',
            'active',
            'activeAt',
            'metadata',
            'metadataVersion',
            'agentState',
            'agentStateVersion',
            'running',
            'runningAt',
            'permissionMode',
        ].sort()

        expect(sessionKeys).toMatchSnapshot()
    })

    test('Workspace response shape', () => {
        const workspaceKeys = [
            'id',
            'namespace',
            'name',
            'folders',
            'createdAt',
            'updatedAt',
        ].sort()

        expect(workspaceKeys).toMatchSnapshot()
    })
})
