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
 *
 * ── 跨包不变量：RFB 首字节不丢（prose 协议，三端合谋维持）──────────
 *
 * 真实 VNC server（macOS 屏幕共享）在 TCP 连接建立后立即发出版本串，
 * 不等任何协商。此时 observe 侧可能尚未加入、hub 的握手代理尚未建立，
 * 任何一端丢弃这段字节，RFB 握手即死锁。时序与职责：
 *
 *   VNC ──版本串──▶ cli ──[TCP pause]──▶ (缓冲) ──▶ hub metadata 门
 *     cli 连接本机 VNC 后先暂停读取，metadata 首帧送达 hub 才开泵；
 *     hub 校验 metadata 前不向浏览器透传任何字节，通过后早期帧入
 *     RelayPath 缓冲，observe 加入/代理建立时移交。
 *
 * 各端职责（破坏该不变量的症状是真机握手挂起，单端 mock 测试可能全绿）：
 * - cli（streamTransport）：连接后 sock.pause()，metadata 上行后 resume()——
 *   删除暂停点 = 版本串在 hub 校验前丢失
 * - hub（RelayPath）：metadata 门之前缓冲、代理建立时移交——改丢弃 = 同上
 * - 联合契约测试：cli 侧 packages/cli/tests/desktop/streamTransport.test.ts
 *   （fake VNC 立即发版本串，断言 metadata 先行）；hub 侧
 *   packages/hub/tests/desktop/relayPath.test.ts「首字节不丢」用例。
 *   两端任一破坏该时序，对应用例红。
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

/**
 * 观看流「归因」注册表（单源）：一次观看流为何结束，决定观看端显示什么文案、
 * 以及要不要自动重连。三端（hub teardown / cli 关闭 / web 决策与文案）一律引用
 * 此表条目，禁止另写 code/prose 字面量——新增归因只改这里。
 *
 * 两条到达路径：带 code 的随 WS close 事件（hub teardown / cli 关闭）；
 * 无 code 的（VNC 认证类）随 noVNC securityfailure 事件的 prose。
 */
export interface DesktopCloseAttribution {
    /** WS close code；VNC 认证类归因不走 close 通道，为 null */
    readonly code: number | null
    /** 协议 prose（即协议：措辞改动等于改协议） */
    readonly prose: string
    /** 观看端文案键；null = 无专属文案（回退通用断开文案），仅可重连归因允许 */
    readonly i18nKey: string | null
    /** 是否可自动重连：归因明确的关闭（抢占/关流/上游不可用/认证失败）一律 false */
    readonly retryable: boolean
}

export const DESKTOP_CLOSE_ATTRIBUTIONS = {
    superseded: { code: 4000, prose: 'superseded', i18nKey: 'desktop.failure.superseded', retryable: false },
    peerGone: { code: 4001, prose: 'peer gone', i18nKey: null, retryable: true },
    streamClosed: { code: 4002, prose: 'stream closed by user', i18nKey: 'desktop.failure.streamClosed', retryable: false },
    upstreamUnavailable: { code: 4003, prose: 'upstream unavailable', i18nKey: 'desktop.failure.upstreamUnavailable', retryable: false },
    vncAuthFailed: { code: null, prose: 'vnc auth failed', i18nKey: 'desktop.failure.vncAuthFailed', retryable: false },
    vncPasswordMissing: { code: null, prose: 'vnc password not configured', i18nKey: 'desktop.failure.vncPasswordMissing', retryable: false },
} as const satisfies Record<string, DesktopCloseAttribution>

export type DesktopCloseAttributionId = keyof typeof DESKTOP_CLOSE_ATTRIBUTIONS

/** 按 WS close code 查归因（无条目 = 网络类/协议类，走重连与通用文案） */
export function desktopCloseAttributionByCode(code: number): DesktopCloseAttribution | null {
    return Object.values(DESKTOP_CLOSE_ATTRIBUTIONS).find((a) => a.code === code) ?? null
}

/** 按 prose 查归因（securityfailure 通道；prose 即协议） */
export function desktopCloseAttributionByProse(prose: string): DesktopCloseAttribution | null {
    return Object.values(DESKTOP_CLOSE_ATTRIBUTIONS).find((a) => a.prose === prose) ?? null
}

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
