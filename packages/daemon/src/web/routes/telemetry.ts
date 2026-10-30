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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 会话遥测（OpenTelemetry）设置路由：telemetry 块真相源在 daemon 自己的
 * settings.daemon.json（与 memory 路由同构）。GET 脱敏回显 / POST 锁内合并写。
 * spawn 时现读注入 OTEL_* env（lifecycle.makeResolveTelemetryEnv），「下个新会话生效」。
 */
import { Hono } from 'hono'
import {
    TelemetrySettingsSubmissionSchema,
    normalizeOtelHeaderRecord,
    redactTelemetrySettings,
    type TelemetrySettings,
    type TelemetrySettingsSubmission,
} from '@mobi/shared'
import type { WebAppEnv } from '../middleware/auth'
import { getConfiguration } from '../../configuration'
import { readSettings, updateSettingsFile } from '../../config/settings'

export interface TelemetryRoutesDeps {
    /** 设置文件路径（测试注入用；缺省走 configuration 单例） */
    getSettingsFile?: () => string
}

/**
 * 提交合并（锁内读-改-写的 updater，纯函数便于单测）：
 * - headers 在场性协议（与 memory apiToken 一致）：不在场 = 保持旧值；
 *   空对象 = 显式清除；非空 = 整体替换（值 trim，全空值键剔除）
 * - enabled / endpoint 整体替换
 */
export function mergeTelemetrySubmission(
    current: TelemetrySettings | undefined,
    submission: TelemetrySettingsSubmission,
): TelemetrySettings {
    const next: TelemetrySettings = { ...current }
    if (submission.enabled !== undefined) next.enabled = submission.enabled
    if (submission.endpoint !== undefined) next.endpoint = submission.endpoint.trim() || undefined
    if (submission.includeContent !== undefined) next.includeContent = submission.includeContent
    if (submission.includeRawApiBodies !== undefined) next.includeRawApiBodies = submission.includeRawApiBodies
    if (submission.includeMetrics !== undefined) next.includeMetrics = submission.includeMetrics
    if (submission.headers !== undefined) {
        // 规范化单源在 shared（trim 剔空）：落盘恒为干净的非空对
        const cleaned = normalizeOtelHeaderRecord(submission.headers)
        next.headers = Object.keys(cleaned).length > 0 ? cleaned : undefined
    }
    return next
}

export function createTelemetryRoutes(deps: TelemetryRoutesDeps = {}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const settingsFileOf = deps.getSettingsFile ?? (() => getConfiguration().settingsFile)

    // 脱敏读：headers 只回「设没设」，不回传值（headers 通常携带云产品认证 token）
    app.get('/telemetry', async (c) => {
        const settings = await readSettings(settingsFileOf())
        return c.json({ settings: redactTelemetrySettings(settings?.telemetry) })
    })

    // 锁内合并写：走 updateSettingsFile（与 token 轮换等写路径互斥，避免 lost update）
    app.post('/telemetry', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = TelemetrySettingsSubmissionSchema.safeParse(body)
        if (!parsed.success) {
            const issue = parsed.error.issues[0]
            return c.json({ error: `Invalid telemetry settings (${issue?.path.join('.') ?? 'body'}): ${issue?.message ?? ''}` }, 400)
        }

        const settingsFile = settingsFileOf()
        const saved = await updateSettingsFile(settingsFile, (current) => ({
            ...current,
            telemetry: mergeTelemetrySubmission(current.telemetry, parsed.data),
        }))
        return c.json({ settings: redactTelemetrySettings(saved.telemetry) })
    })

    return app
}
