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

/**
 * 长期记忆设置路由（agent-memory 票 03）：memory 块真相源在 daemon 自己的
 * settings.daemon.json（与 webTools 的「透传宿主配置」链路不同，不依赖 executor）。
 * GET 脱敏回显 / POST 锁内合并写 / POST check 健康检查（草稿值优先，未保存也能检查）。
 */
import { Hono } from 'hono'
import {
    MemorySettingsSubmissionSchema,
    MemoryEndpointCheckSchema,
    redactMemorySettings,
    type MemoryEndpointCheckResult,
    type MemorySettings,
    type MemorySettingsSubmission,
} from '@mobi/shared'
import type { WebAppEnv } from '../middleware/auth'
import { getConfiguration } from '../../configuration'
import { readSettings, updateSettingsFile } from '../../config/settings'

/** 健康检查超时（毫秒）：本地自建服务/远端 Cloud 均应秒级响应 */
const CHECK_TIMEOUT_MS = 5_000

export interface MemoryRoutesDeps {
    /** 设置文件路径（测试注入用；缺省走 configuration 单例） */
    getSettingsFile?: () => string
    /** 可注入的探针（测试用；缺省用全局 fetch） */
    fetch?: typeof fetch
}

/**
 * 提交合并（锁内读-改-写的 updater，纯函数便于单测）：
 * - apiToken 在场性协议：不在场 = 保持旧值；空串 = 清除；非空 = 覆盖
 * - 其余字段（engine/endpoint/rules/disabledWorkspaces/bankName）整体替换
 */
export function mergeMemorySubmission(
    current: MemorySettings | undefined,
    submission: MemorySettingsSubmission,
): MemorySettings {
    const next: MemorySettings = { ...current }
    if (submission.engine !== undefined) next.engine = submission.engine
    if (submission.endpoint !== undefined) next.endpoint = submission.endpoint
    if (submission.rules !== undefined) next.rules = submission.rules
    if (submission.disabledWorkspaces !== undefined) next.disabledWorkspaces = submission.disabledWorkspaces
    if (submission.bankName !== undefined) next.bankName = submission.bankName?.trim() || undefined
    if (submission.apiToken !== undefined) {
        // 空串 = 清除（undefined 键移除，spawn 裁决侧 trim 后判空）
        next.apiToken = submission.apiToken.trim() || undefined
    }
    return next
}

/**
 * endpoint 健康检查（纯函数，注入 fetch 便于单测）：
 * - 401/403 → unauthorized（key 错）
 * - 5xx → error（服务在但异常）
 * - 其余任何响应（200/404/405…）→ ok（可达且未拒绝鉴权——base URL 对 GET 返回
 *   404/405 是常态，能回 HTTP 响应即证明服务在、地址对）
 * - 网络异常/超时 → unreachable（服务未起/地址错）
 */
export async function checkMemoryEndpoint(
    endpoint: string,
    token: string | undefined,
    fetchImpl: typeof fetch = fetch,
): Promise<MemoryEndpointCheckResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
    try {
        const started = Date.now()
        const res = await fetchImpl(endpoint, {
            method: 'GET',
            signal: controller.signal,
            headers: token ? { authorization: `Bearer ${token}` } : {},
        })
        if (res.status === 401 || res.status === 403) return { status: 'unauthorized' }
        if (res.status >= 500) return { status: 'error', reason: `HTTP ${res.status}` }
        return { status: 'ok', latencyMs: Date.now() - started }
    } catch (error) {
        return { status: 'unreachable', reason: error instanceof Error ? error.message : String(error) }
    } finally {
        clearTimeout(timer)
    }
}

export function createMemoryRoutes(deps: MemoryRoutesDeps = {}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const settingsFileOf = deps.getSettingsFile ?? (() => getConfiguration().settingsFile)
    const fetchImpl = deps.fetch ?? fetch

    // 脱敏读：apiToken 只回「设没设」，不回传值（与 webTools 凭据回显同红线）
    app.get('/memory', async (c) => {
        const settings = await readSettings(settingsFileOf())
        return c.json({ settings: redactMemorySettings(settings?.memory) })
    })

    // 锁内合并写：走 updateSettingsFile（与 token 轮换等写路径互斥，避免 lost update）
    app.post('/memory', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = MemorySettingsSubmissionSchema.safeParse(body)
        if (!parsed.success) {
            const issue = parsed.error.issues[0]
            return c.json({ error: `Invalid memory settings (${issue?.path.join('.') ?? 'body'}): ${issue?.message ?? ''}` }, 400)
        }

        const settingsFile = settingsFileOf()
        const saved = await updateSettingsFile(settingsFile, (current) => ({
            ...current,
            memory: mergeMemorySubmission(current.memory, parsed.data),
        }))
        return c.json({ settings: redactMemorySettings(saved.memory) })
    })

    // 健康检查：草稿 token 优先（空串 = 显式清除态检查），不在场用已存值兜底
    app.post('/memory/check', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = MemoryEndpointCheckSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid check request: endpoint is required' }, 400)
        }

        let token = parsed.data.apiToken
        if (token === undefined) {
            const settings = await readSettings(settingsFileOf())
            token = settings?.memory?.apiToken?.trim() || undefined
        }
        const result = await checkMemoryEndpoint(parsed.data.endpoint.trim(), token, fetchImpl)
        return c.json(result)
    })

    return app
}
