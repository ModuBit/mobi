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
 * makeResolveTelemetryEnv 档位映射（OpenTelemetry 设置票）：设置块 → OTEL_* env 的
 * 策略本体在此，直接单测（spawnSession 侧只锁「resolver 输出并入子 env」的透传）。
 * configuration / readSettings 模块级 mock——被测函数只在调用时读，mock 落点最小。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeResolveTelemetryEnv } from '@/executor/lifecycle'
import type { TelemetrySettings } from '@mobi/shared'

const readSettingsMock = vi.fn<() => Promise<{ telemetry?: TelemetrySettings } | undefined>>()

vi.mock('@/configuration', () => ({
    getConfiguration: () => ({ settingsFile: '/tmp/fake-settings.json' }),
}))
vi.mock('@/config/settings', () => ({
    readSettings: (file: string) => {
        expect(file).toBe('/tmp/fake-settings.json')
        return readSettingsMock()
    },
}))

describe('makeResolveTelemetryEnv 档位映射', () => {
    beforeEach(() => {
        readSettingsMock.mockReset()
    })

    it('未启用 / 缺 endpoint / 读盘异常 → 空对象（不阻断 spawn）', async () => {
        const resolve = makeResolveTelemetryEnv()
        for (const settings of [
            undefined,
            { telemetry: { enabled: false, endpoint: 'http://e' } },
            { telemetry: { enabled: true } },
            { telemetry: { enabled: true, endpoint: '   ' } },
        ]) {
            readSettingsMock.mockResolvedValue(settings)
            expect(await resolve()).toEqual({})
        }
        readSettingsMock.mockRejectedValue(new Error('disk boom'))
        expect(await resolve()).toEqual({})
    })

    it('基线：enabled+endpoint → traces 基础五键，无内容/指标键', async () => {
        readSettingsMock.mockResolvedValue({
            telemetry: { enabled: true, endpoint: 'http://collector:4318' },
        })
        const env = await makeResolveTelemetryEnv()()
        expect(env).toEqual({
            CLAUDE_CODE_ENABLE_TELEMETRY: '1',
            CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
            OTEL_TRACES_EXPORTER: 'otlp',
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        })
    })

    it('档①开 → logs exporter + 内容四门；不叠 RAW_API_BODIES', async () => {
        readSettingsMock.mockResolvedValue({
            telemetry: { enabled: true, endpoint: 'http://e', includeContent: true },
        })
        const env = await makeResolveTelemetryEnv()()
        expect(env.OTEL_LOGS_EXPORTER).toBe('otlp')
        expect(env.OTEL_LOG_USER_PROMPTS).toBe('1')
        expect(env.OTEL_LOG_ASSISTANT_RESPONSES).toBe('1')
        expect(env.OTEL_LOG_TOOL_DETAILS).toBe('1')
        expect(env.OTEL_LOG_TOOL_CONTENT).toBe('1')
        expect(env.OTEL_LOG_RAW_API_BODIES).toBeUndefined()
    })

    it('档②开（隐含档①）→ RAW_API_BODIES 叠加，四门照样全开', async () => {
        readSettingsMock.mockResolvedValue({
            telemetry: { enabled: true, endpoint: 'http://e', includeRawApiBodies: true },
        })
        const env = await makeResolveTelemetryEnv()()
        expect(env.OTEL_LOG_RAW_API_BODIES).toBe('1')
        expect(env.OTEL_LOGS_EXPORTER).toBe('otlp')
        expect(env.OTEL_LOG_USER_PROMPTS).toBe('1')
        expect(env.OTEL_LOG_TOOL_CONTENT).toBe('1')
    })

    it('includeMetrics → OTEL_METRICS_EXPORTER；headers 经 OTLP 标准形态编码（trim 剔空、值 URL 编码）', async () => {
        readSettingsMock.mockResolvedValue({
            telemetry: {
                enabled: true,
                endpoint: 'http://e',
                includeMetrics: true,
                headers: { 'DD-API-KEY': ' secret ', empty: '   ', 'x-key': 'a,b=c' },
            },
        })
        const env = await makeResolveTelemetryEnv()()
        expect(env.OTEL_METRICS_EXPORTER).toBe('otlp')
        // 逗号/等号编码后不被拆成多个 header（OTel SDK 读取侧 URL 解码还原）
        expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe('DD-API-KEY=secret,x-key=a%2Cb%3Dc')
    })
})
