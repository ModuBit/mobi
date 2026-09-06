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

import { z } from 'zod'
import { PermissionModeSchema } from './schemas'
import { EFFORT_LEVELS } from './modes'

/**
 * 会话配置字段注册表（深化候选②）：「改会话的一个配置项」的单一声明源。
 *
 * 背景：permissionMode / model / effort / outputStyle 各铺一条 web → hub 路由 → RPC →
 * cli 的完整纵切，四条互不复用（live 即时生效组 / restart 重启生效组），新增字段要
 * 手工接线约十处且历史上已三次靠对焦补丁修「漏接」（cb366322 / 2fd3150e / 88da6179）。
 * 收口的是声明与校验——hub 路由 body schema 与 cli handler 校验同源于此，杜绝两端漂移。
 *
 * 注意：注册表收口的是「声明和接线」，不强行统一 live / restart 两种生效机制——
 * outputStyle 的 /clear 语义（哨兵退轮、重启后 init 上报权威值）与 live 字段的
 * 运行中动态 apply 本质不同，机制仍在各自通道实现。
 */

/** 生效语义：live = 运行中动态 apply（set-session-config RPC）；restart = 触发 query 重启后生效 */
export type SessionConfigApplyKind = 'live' | 'restart'

/** 单个会话配置字段的声明 */
export type SessionConfigField = {
    apply: SessionConfigApplyKind
    /** 值校验（hub 路由 body 与 cli RPC handler 共用同源） */
    schema: z.ZodTypeAny
    /** 对外 REST body 字段名（web API 兼容契约：mode / model / effort / style） */
    bodyKey: string
}

export const SESSION_CONFIG_FIELDS = {
    permissionMode: {
        apply: 'live',
        schema: PermissionModeSchema,
        bodyKey: 'mode',
    },
    model: {
        apply: 'live',
        schema: z.string().nullable(),
        bodyKey: 'model',
    },
    effort: {
        apply: 'live',
        schema: z.enum(EFFORT_LEVELS),
        bodyKey: 'effort',
    },
    outputStyle: {
        apply: 'restart',
        // 不用 OUTPUT_STYLES 枚举：CLI 支持自定义 style（settings.cli.json），此处只挡空串，
        // 合法性由 CLI 侧 switch-output-style handler 守卫（/clear 语义受理 + running/rewind 拒绝）
        schema: z.string().min(1),
        bodyKey: 'style',
    },
} as const satisfies Record<string, SessionConfigField>

export type SessionConfigFieldKey = keyof typeof SESSION_CONFIG_FIELDS

/**
 * restart 语义配置切换的结构化受理结果（深化候选⑥，rewind 先例）：
 * CLI RPC handler 返回 `{accepted, reason?}`——业务拒绝不走 throw（RPC 错误通道只剩
 * message 字符串，跨包据文案反解分层会因改文案静默失效），语义由结构承载。
 * hub 侧在此之上叠加 confirmed（RPC 是否得到 CLI 明确回答）区分 409 / 502。
 */
export type RpcAcceptResult = {
    accepted: true
} | {
    accepted: false
    /** 拒绝原因（用户可读，web toast / 409 body 透出） */
    reason: string
}
