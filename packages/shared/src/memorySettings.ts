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
 * 长期记忆设置协议（跨 daemon/web 共享，agent-memory 票 03）。
 *
 * 明文真相源在 daemon 的 settings.daemon.json `memory` 段（daemon 包消费裁决/生成链路），
 * 回显给 Web 前端时必须脱敏：apiToken 只回「设没设」（apiTokenSet），不回传值——
 * 与 webtools 的 RedactedWebToolsConfig 同一威胁模型与红线。
 */
import { z } from 'zod'

/** 落盘方向 schema（daemon settings.daemon.json memory 段的权威形状） */
export const MemorySettingsSchema = z.object({
    /** 引擎三态：off（默认）/ hindsight；mem0 为未来候选值（daemon 裁决侧未知值 fail-closed 归 off） */
    engine: z.enum(['off', 'hindsight']).optional(),
    /** Hindsight API 地址（Cloud 或 self-host）；engine 非 off 时必填（spawn 裁决时校验） */
    endpoint: z.string().optional(),
    /** API token 明文（仅 daemon 落盘与 env 注入，绝不回显给 web） */
    apiToken: z.string().optional(),
    /** 路径 → bank 例外映射（硬隔离/分组共享），原样写入 mobi 管理配置文件 */
    mapPathToBank: z.record(z.string(), z.string()).optional(),
    /** workspace 级记忆关闭名单（工作区目录绝对路径，前缀匹配、支持 ~） */
    disabledWorkspaces: z.array(z.string()).optional(),
    /** 多用户 bank 命名空间前缀（v1 仅 schema 预留，无 UI 不暴露提交面） */
    bankNamespace: z.string().optional(),
})
export type MemorySettings = z.infer<typeof MemorySettingsSchema>

/**
 * 提交方向 schema（web → daemon POST /api/memory 请求体）：
 * apiToken 在场性协议（对齐 webTools 凭据提交）：不在场 = 保持旧值（未修改）；
 * 空串 = 清除；非空 = 覆盖。bankNamespace 不在提交面（UI 不暴露，落盘侧保留）。
 */
export const MemorySettingsSubmissionSchema = z.object({
    engine: z.enum(['off', 'hindsight']).optional(),
    endpoint: z.string().optional(),
    apiToken: z.string().optional(),
    mapPathToBank: z.record(z.string(), z.string()).optional(),
    disabledWorkspaces: z.array(z.string()).optional(),
})
export type MemorySettingsSubmission = z.infer<typeof MemorySettingsSubmissionSchema>

/** 回显方向：apiToken 脱敏为「设没设」标记（无 preview——密码态输入无需掩码提示长度） */
export type RedactedMemorySettings = Omit<MemorySettings, 'apiToken' | 'bankNamespace'> & {
    apiTokenSet: boolean
}

/** 回显脱敏（daemon 路由 GET /api/memory 的响应体构造） */
export function redactMemorySettings(memory: MemorySettings | undefined): RedactedMemorySettings {
    const { apiToken: _token, bankNamespace: _ns, ...rest } = memory ?? {}
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
