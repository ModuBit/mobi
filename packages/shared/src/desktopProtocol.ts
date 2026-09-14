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
 * Desktop 远程桌面协议定义（迭代 1：只读观看）
 *
 * 三个通道的形状契约：
 * - watch API（web → hub，HTTP）：请求/响应
 * - attach metadata（cli → hub，raw WS 首帧，二进制 JSON）：流绑定与身份声明
 * - raw WS 路径常量（hub Bun.serve 分流依据）
 */

import { z } from 'zod'

/** hub raw WS 路径：cli 反连 attach（携带一次性 attach ticket） */
export const DESKTOP_ATTACH_PATH = '/desktop/attach'
/** hub raw WS 路径：浏览器 observe（携带一次性 observe token） */
export const DESKTOP_OBSERVE_PATH = '/desktop/observe'

/**
 * attach metadata（cli 反连后 raw WS 首帧，二进制 JSON）。
 * 迭代 1 只带协议版本；VNC 密码（hub 代认证）在迭代 2 加入。
 */
export const desktopAttachMetadataSchema = z.object({
    protocol: z.literal('mobi-desktop-1'),
    machineId: z.string().min(1),
})

export type DesktopAttachMetadata = z.infer<typeof desktopAttachMetadataSchema>

/** POST /api/desktop/watch 请求体 */
export const desktopWatchRequestSchema = z.object({
    machineId: z.string().min(1),
})

export type DesktopWatchRequest = z.infer<typeof desktopWatchRequestSchema>

/** POST /api/desktop/watch 响应体：observe 凭据（一次性，短时效） */
export const desktopWatchResponseSchema = z.object({
    observeToken: z.string().min(1),
    expiresAtMs: z.number().int().positive(),
})

export type DesktopWatchResponse = z.infer<typeof desktopWatchResponseSchema>

/** hub → cli 的 desktop-stream RPC 请求参数 */
export const desktopStreamRequestSchema = z.object({
    ticket: z.string().min(1),
    attachPath: z.string().min(1),
})

export type DesktopStreamRequest = z.infer<typeof desktopStreamRequestSchema>

/**
 * VNC 密码提交（web → hub → cli 落 settings.cli.json）。
 * macOS「VNC 观看者密码」上限 8 字符，超长必然与系统配置不一致，schema 层直接拒。
 */
export const desktopVncPasswordSubmissionSchema = z.object({
    vncPassword: z.string().min(1).max(8),
})

export type DesktopVncPasswordSubmission = z.infer<typeof desktopVncPasswordSubmissionSchema>

/** VNC 密码配置状态（只回「是否已配置」，密码本身永不回读） */
export const desktopVncStatusSchema = z.object({
    configured: z.boolean(),
})

export type DesktopVncStatus = z.infer<typeof desktopVncStatusSchema>

/**
 * observe WS 的 data 标记（hub Bun.serve websocket handler 分流依据）。
 * engine 的 data 形状是 { transport }，desktop 用专属 key 避免歧义。
 */
export const DESKTOP_WS_DATA_KEY = '__mobiDesktop'
