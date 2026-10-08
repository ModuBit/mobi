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
 * 长期记忆设置协议（跨 daemon/web 共享，agent-memory 票 03；三档隔离票 05 改形）。
 *
 * 明文真相源在 daemon 的 settings.daemon.json `memory` 段（daemon 包消费裁决/生成链路），
 * 回显给 Web 前端时必须脱敏：apiToken 只回「设没设」（apiTokenSet），不回传值——
 * 与 webtools 的 RedactedWebToolsConfig 同一威胁模型与红线。
 */
import { z } from 'zod'

/**
 * 记忆隔离档位（spec 三档定稿）：
 * - normal（默认）：全局池 + project tag 溯源 + any 召回（本项目 ∪ 全局层）
 * - open：全局池 + 不打 tag（无 tag 记忆的主动写入口）+ 全量召回
 * - isolated：独立 bank 物理分库 + 不过滤
 */
export const MemoryIsolationModeSchema = z.enum(['normal', 'open', 'isolated'])
export type MemoryIsolationMode = z.infer<typeof MemoryIsolationModeSchema>

/**
 * 规则目标（discriminated union，扩展点：后续加目标类型只加 literal）：
 * - workspace：按会话 spawn 时明确指定的 workspaceId 直查（档位跟工作区语境走，
 *   同目录挂多个不同档 workspace 时无歧义——从哪个 workspace spawn 用哪个档）
 * - path：路径前缀匹配（裸目录 spawn 兜底；~ 展开；最长前缀优先）
 */
export const MemoryRuleTargetSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('workspace'), id: z.string().min(1) }),
    z.object({ type: z.literal('path'), path: z.string().min(1) }),
])
export type MemoryRuleTarget = z.infer<typeof MemoryRuleTargetSchema>

/**
 * 记忆隔离规则：目标 + 档位 + 可选覆盖。
 * 覆盖缺省时 tag/bank 按会话目录的 gitProject 自动派生（稳定锚在仓库名，
 * workspace 改名不产生孤儿）——组共享/组隔离语义由覆盖值显式承载。
 */
export const MemoryRuleSchema = z.object({
    target: MemoryRuleTargetSchema,
    mode: MemoryIsolationModeSchema,
    /** normal 档共享组名（多目标同名 = 读写对称互通，含未固化窗口） */
    tag: z.string().min(1).optional(),
    /** isolated 档隔离库名（缺省 mobi-iso-<gitProject>，多仓库共用一库时覆盖） */
    bank: z.string().min(1).optional(),
})
export type MemoryRule = z.infer<typeof MemoryRuleSchema>

/** 落盘方向 schema（daemon settings.daemon.json memory 段的权威形状） */
export const MemorySettingsSchema = z.object({
    /** 引擎三态：off（默认）/ hindsight；mem0 为未来候选值（daemon 裁决侧未知值 fail-closed 归 off） */
    engine: z.enum(['off', 'hindsight']).optional(),
    /** Hindsight API 地址（Cloud 或 self-host）；engine 非 off 时必填（spawn 裁决时校验） */
    endpoint: z.string().optional(),
    /** API token 明文（仅 daemon 落盘与 env 注入，绝不回显给 web） */
    apiToken: z.string().optional(),
    /** 隔离规则（路径规则 > workspace 规则 > 默认 normal；未命中路径/工作区 = normal） */
    rules: z.array(MemoryRuleSchema).optional(),
    /** workspace 级记忆关闭名单（工作区目录绝对路径，前缀匹配、支持 ~） */
    disabledWorkspaces: z.array(z.string()).optional(),
    /** 全局池 bank 名（高级覆盖，缺省 mobi-global） */
    bankName: z.string().min(1).optional(),
})
export type MemorySettings = z.infer<typeof MemorySettingsSchema>

/**
 * 提交方向 schema（web → daemon POST /api/memory 请求体）：
 * apiToken 在场性协议（对齐 webTools 凭据提交）：不在场 = 保持旧值（未修改）；
 * 空串 = 清除；非空 = 覆盖。
 */
export const MemorySettingsSubmissionSchema = z.object({
    engine: z.enum(['off', 'hindsight']).optional(),
    endpoint: z.string().optional(),
    apiToken: z.string().optional(),
    rules: z.array(MemoryRuleSchema).optional(),
    disabledWorkspaces: z.array(z.string()).optional(),
    bankName: z.string().optional(),
})
export type MemorySettingsSubmission = z.infer<typeof MemorySettingsSubmissionSchema>

/** 回显方向：apiToken 脱敏为「设没设」标记（无 preview——密码态输入无需掩码提示长度） */
export type RedactedMemorySettings = Omit<MemorySettings, 'apiToken'> & {
    apiTokenSet: boolean
}

/** 回显脱敏（daemon 路由 GET /api/memory 的响应体构造） */
export function redactMemorySettings(memory: MemorySettings | undefined): RedactedMemorySettings {
    const { apiToken: _token, ...rest } = memory ?? {}
    return { ...rest, apiTokenSet: Boolean(_token?.trim()) }
}

/** 健康检查请求体（草稿优先：token 不在场时 daemon 用已存值兜底，未保存也能检查） */
export const MemoryEndpointCheckSchema = z.object({
    endpoint: z.string().min(1),
    /** 草稿 token；缺省 = 用已存值（空对象标记「显式清除后检查」由空串承载） */
    apiToken: z.string().optional(),
})

/** 健康检查结果分类（web 据此区分文案：服务未起/地址错 → unreachable，key 错 → unauthorized） */
export type MemoryEndpointCheckResult =
    | { status: 'ok'; latencyMs: number }
    | { status: 'unreachable'; reason: string }
    | { status: 'unauthorized' }
    | { status: 'error'; reason: string }

// ---------------------------------------------------------------------------
// endpoint 拓扑知识（协议层单源）：hindsight 部署形态的地址推断，web 表现层
// （endpoint 占位 / 「数据出本机」提示 / 「打开记忆界面」链接）消费。
// self-host UI 端口（:9999）是 vendored 版本实测行为，升级 vendored 时同步（VENDOR-NOTES）。
// ---------------------------------------------------------------------------

/** Cloud 默认 API 地址（endpoint 输入占位提示） */
export const HINDSIGHT_CLOUD_API_URL = 'https://api.hindsight.vectorize.io'

/**
 * endpoint 解析单源：合法 URL 且 hostname 非空才可用。无 scheme 的输入
 * （`localhost:9999`）会被 WHATWG URL 按非标准 protocol 解析而不抛错、hostname 为空——
 * 不拦住会误判「数据出本机」并生成坏链接。
 */
export function parseEndpointUrl(endpoint: string): URL | null {
    const trimmed = endpoint.trim()
    if (!trimmed) return null
    try {
        const url = new URL(trimmed)
        return url.hostname ? url : null
    } catch {
        return null
    }
}

/** 主机名是否指向本机（不出本机的判定） */
export function isLocalHostname(hostname: string): boolean {
    return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(hostname)
}

/** endpoint 是否会把记忆数据送出本机（可用 URL 且主机非本机 → 提示「数据将离开本机」） */
export function isOffMachineEndpoint(endpoint: string): boolean {
    const url = parseEndpointUrl(endpoint)
    return url ? !isLocalHostname(url.hostname) : false
}

/**
 * 「打开记忆界面」链接（纯函数）：
 * Cloud（hindsight.vectorize.io 域）→ 官方 dashboard；self-host → 同主机 9999 端口。
 * 非法/空 endpoint → null（不渲染链接）。
 */
export function deriveMemoryUiUrl(endpoint: string): string | null {
    const url = parseEndpointUrl(endpoint)
    if (!url) return null
    if (url.hostname === 'hindsight.vectorize.io' || url.hostname.endsWith('.hindsight.vectorize.io')) {
        return 'https://ui.hindsight.vectorize.io'
    }
    return `${url.protocol}//${url.hostname}:9999`
}
