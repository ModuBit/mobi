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
 * vncPassword 可选（hub 代认证用）：hub 内存持有替浏览器应答 VNC 挑战，
 * 不落盘不日志；密码真身在被控机，hub/web 均无副本。
 * 上限 16 与 macOS 屏幕共享输入框对齐；RFB DES 密钥只有 8 字节，
 * 超长部分两端同样截断（仅前 8 位参与认证）。
 */
export const desktopAttachMetadataSchema = z.object({
    protocol: z.literal('mobi-desktop-1'),
    machineId: z.string().min(1),
    vncPassword: z.string().min(1).max(16).optional(),
})

export type DesktopAttachMetadata = z.infer<typeof desktopAttachMetadataSchema>

/** POST /api/desktop/watch 请求体 */
export const desktopWatchRequestSchema = z.object({
    machineId: z.string().min(1),
})

export type DesktopWatchRequest = z.infer<typeof desktopWatchRequestSchema>

/** 控制权状态：view-only（服务端剥输入）/ controlled（输入放行，SetDesktopSize 仍恒剥） */
export const desktopControlStateSchema = z.enum(['view-only', 'controlled'])

export type DesktopControlState = z.infer<typeof desktopControlStateSchema>

/** POST /api/desktop/watch 响应体：observe 凭据（一次性，短时效）+ 控制权权威初值 */
export const desktopWatchResponseSchema = z.object({
    observeToken: z.string().min(1),
    expiresAtMs: z.number().int().positive(),
    /**
     * 控制权权威初值：新观看流恒从 view-only 起（控制权随观看流生命周期存亡）。
     * web 以此初始化每个连接代际的状态，本地快照只作同会话内的乐观显示——
     * 重连到新流必须回到服务端值，禁止重放旧流快照（权限边界在 hub）。
     */
    control: desktopControlStateSchema,
})

export type DesktopWatchResponse = z.infer<typeof desktopWatchResponseSchema>

/** GET /api/desktop/streams 响应体：hub 上的活跃观看流（侧边栏列表数据源） */
export const desktopStreamsResponseSchema = z.object({
    streams: z.array(
        z.object({
            sessionId: z.string().min(1),
            machineId: z.string().min(1),
            startedAtMs: z.number().int().positive(),
            /** 控制权状态（迭代 2）：web 初次加载时以此对齐，后续经 desktop-control-changed 事件同步 */
            control: desktopControlStateSchema,
        }),
    ),
})

export type DesktopStreamsResponse = z.infer<typeof desktopStreamsResponseSchema>

/** 控制权授予/退出响应体 */
export const desktopControlResponseSchema = z.object({
    sessionId: z.string().min(1),
    machineId: z.string().min(1),
    control: desktopControlStateSchema,
})

export type DesktopControlResponse = z.infer<typeof desktopControlResponseSchema>

/** hub → cli 的 desktop-stream RPC 请求参数 */
export const desktopStreamRequestSchema = z.object({
    ticket: z.string().min(1),
    attachPath: z.string().min(1),
})

export type DesktopStreamRequest = z.infer<typeof desktopStreamRequestSchema>

/**
 * 观看流 WS 关闭码（hub 发、web/cli 读写）：跨端协议契约的唯一真相源。
 * hub 定义 teardown 发码，web 按码判定「归因明确、不自动重连」。
 */
export const DESKTOP_CLOSE_CODE = {
    /** 被抢占（同机新观看） */
    SUPERSEDED: 4000,
    /** 对端消失（观看页关闭/超时） */
    PEER_GONE: 4001,
    /** 被主动关闭（侧边栏关流 / cli 不可达回滚） */
    CLOSED: 4002,
    /** 上游不可用（本机 VNC 拒连，cli 发起） */
    UPSTREAM_UNAVAILABLE: 4003,
    /** 协议错误（帧超限/元数据非法/解析失败） */
    PROTOCOL: 1008,
} as const

/**
 * 观看流关闭归因 reason 字符串（hub teardown/cli 关闭时写，web 匹配后翻译成
 * 用户文案）：prose 即协议，改动措辞须三端同步——一律引用此常量。
 */
export const DESKTOP_CLOSE_REASONS = {
    VNC_AUTH_FAILED: 'vnc auth failed',
    VNC_PASSWORD_MISSING: 'vnc password not configured',
    STREAM_CLOSED: 'stream closed by user',
    SUPERSEDED: 'superseded',
    UPSTREAM_UNAVAILABLE: 'upstream unavailable',
} as const

/** http(s) hub 地址 → ws(s)：desktop 流两端的 WS 地址统一由它派生 */
export function desktopWsOrigin(hubUrl: string): string {
    return hubUrl.replace(/^http/i, 'ws')
}

/**
 * VNC 密码（web → hub 提交段，含 machineId 路由；hub → cli 落盘段只传密码，
 * 用 desktopVncPasswordSchema）。上限 16 与 macOS 屏幕共享输入框对齐；
 * RFB 协议密钥只有 8 字节，超长部分截断——仅前 8 位参与认证（与 macOS 内部行为一致）。
 */
export const desktopVncPasswordSchema = z.object({
    vncPassword: z.string().min(1).max(16),
})

export type DesktopVncPassword = z.infer<typeof desktopVncPasswordSchema>

export const desktopVncPasswordSubmissionSchema = desktopVncPasswordSchema.extend({
    machineId: z.string().min(1),
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
