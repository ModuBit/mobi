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
 * 会话遥测（OpenTelemetry）设置协议（跨 daemon/web 共享）。
 *
 * 明文真相源在 daemon 的 settings.daemon.json `telemetry` 段；spawn 时现读并把
 * OTEL_* env 注入会话子进程（Claude Code CLI 内建 OTel，traces 覆盖每次交互/
 * 模型请求/工具调用/hook 的 span）。设置变更自然落到下一个新会话，无热推送。
 *
 * 回显给 Web 前端时必须脱敏：headers 通常携带云产品的认证 token（DD-API-KEY、
 * x-honeycomb-team 等），只回「设没设」（headersSet），不回传值——与 memory 的
 * apiTokenSet / webtools 的凭据回显同一威胁模型与红线。
 */
import { z } from 'zod'

/**
 * 会话遥测（OpenTelemetry）设置块。信号面：traces 恒导出（时延与名称，不含对话
 * 正文）；内容类信号分档显式知情：
 * - 档① includeContent：用户消息/助手回复全文、工具出入参、工具输出（log events 四门）
 * - 档② includeRawApiBodies：完整 Messages API 请求体（含 system prompt 与全部历史）
 * - includeMetrics：token/cost 等纯数字计数器
 */
export const TelemetrySettingsSchema = z.object({
    /** 总开关（缺省 false）：off 时 spawn 不注入任何 OTEL env */
    enabled: z.boolean().optional(),
    /** OTLP collector 地址（http://host:4318 形态；OTLP HTTP + protobuf 固定协议） */
    endpoint: z.string().optional(),
    /**
     * 附加 OTLP 导出头（认证）：`{ 'DD-API-KEY': 'xxx', 'x-honeycomb-team': 'yyy' }`，
     * daemon 侧编码为 OTEL_EXPORTER_OTLP_HEADERS 的 `k=v,k2=v2` 形态。
     * 协议面只收非空键值——语义化校验（是否像 token）不在此层。
     */
    headers: z.record(z.string(), z.string().min(1)).optional(),
    /**
     * 档①消息与工具内容（缺省 false）：用户消息/助手回复全文、工具出入参、工具输出
     * （OTEL_LOG_USER_PROMPTS/ASSISTANT_RESPONSES/TOOL_DETAILS/TOOL_CONTENT 四门全开）。
     * 对话内容出网到 collector——隐私档位高于纯时延 trace。
     */
    includeContent: z.boolean().optional(),
    /**
     * 档②完整 API 请求体（缺省 false，隐含档①）：完整 Messages API 请求/响应 JSON
     * （OTEL_LOG_RAW_API_BODIES）——含 system prompt 与全部对话历史，体积大
     * （60KB 截断）且敏感度最高，独立开关让用户显式知情。
     */
    includeRawApiBodies: z.boolean().optional(),
    /**
     * 指标导出（缺省 false）：token 用量/cost/会话/工具决策等计数器
     * （OTEL_METRICS_EXPORTER=otlp）——纯数字无内容，按天看消耗趋势用。
     */
    includeMetrics: z.boolean().optional(),
})
export type TelemetrySettings = z.infer<typeof TelemetrySettingsSchema>

/**
 * 提交方向 schema（web → daemon POST /api/telemetry 请求体）：与设置块同形（全字段
 * optional，落哪个字段由合并写决定）。headers 在场性协议与 memory 的 apiToken 一致——
 * 不在场 = 保持旧值；空对象 = 显式清除；非空 = 整体替换。
 */
export const TelemetrySettingsSubmissionSchema = TelemetrySettingsSchema
export type TelemetrySettingsSubmission = TelemetrySettings

/** 回显方向：headers 脱敏为「设没设」标记（write-only——密码态输入无需掩码提示内容） */
export type RedactedTelemetrySettings = Omit<TelemetrySettings, 'headers'> & {
    headersSet: boolean
}

/** 回显脱敏（daemon 路由 GET /api/telemetry 的响应体构造） */
export function redactTelemetrySettings(telemetry: TelemetrySettings | undefined): RedactedTelemetrySettings {
    const { headers, ...rest } = telemetry ?? {}
    return { ...rest, headersSet: Boolean(headers && Object.keys(headers).length > 0) }
}

/**
 * header record 规范化（键值 trim，全空段剔除）——daemon 写入与导出编码共用的单一
 * 事实：落盘的 headers 恒为 trim 过的非空对，编码侧重跑一遍只是手动编辑
 * settings 文件时的廉价防御。
 */
export function normalizeOtelHeaderRecord(
    headers: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers)
            .map(([k, v]) => [k.trim(), v.trim()])
            .filter(([k, v]) => k !== '' && v !== ''),
    )
}

/**
 * OTEL_EXPORTER_OTLP_HEADERS 编码（daemon spawn 注入单源）：
 * record → `k=v,k2=v2`。值按 OTel 规范 URL 编码——token 含 `,`/`=` 等字符时不编码
 * 会被拆成多个错误 header，认证静默失败；OTel SDK 读取侧会对值做 URL 解码。
 * 键是 header 名（来自 web 侧 K=V 草稿解析，天然无逗号/等号），不另编码。
 */
export function encodeOtelHeaders(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) return undefined
    const pairs = Object.entries(normalizeOtelHeaderRecord(headers)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    return pairs.length > 0 ? pairs.join(',') : undefined
}
