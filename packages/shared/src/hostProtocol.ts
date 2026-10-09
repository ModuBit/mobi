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
 * 宿主协议：daemon 与外界（daemon / web / session）的类型契约单一来源——
 * executor 状态上报、spawn 请求/响应、worktree 形状。
 *
 * 这些类型本就是跨进程协议（socket RPC / HTTP webhook），不依赖任何端侧实现；
 * 原先散在 cli 的 api/types 与 modules/common/rpcTypes，personal-agent-rewrite
 * 解缠阶段下沉至此，cli 侧原位置改为 re-export（搬迁票删除 re-export）。
 */

import { z } from 'zod'
import type { EffortLevel, PermissionMode } from './modes'

// —— executor 状态上报协议 ——

/** 机器静态能力与身份（host 名、平台、版本、目录布局） */
export const HostMetadataSchema = z.object({
    host: z.string(),
    platform: z.string(),
    mobiCliVersion: z.string(),
    displayName: z.string().optional(),
    homeDir: z.string(),
    mobiHomeDir: z.string(),
    mobiLibDir: z.string()
})

export type HostMetadata = z.infer<typeof HostMetadataSchema>

// —— executor 状态上报（运行时状态机）——
// Schema 定义在 schemas.ts（协议 schema 单一来源，daemon-status 事件 payload 复用），
// 此处 re-export 保持本文件作为宿主协议类型入口的稳定性

export { ExecutorStateSchema, type ExecutorState } from './schemas'

// —— spawn 契约（daemon executor ↔ 会话子进程）——

export interface SpawnSessionOptions {
    directory: string
    /**
     * mobi 会话行 id（daemon 唤醒/激活路径携带，Web 新建路径尚无行 id 缺省）。
     * executor spawn 查重键之一：同一行已有活 child（含 webhook 尚未到达的在途 child）
     * 时不盲 spawn 第二个进程——#108 首条消息唤醒竞态的闸
     */
    sessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude'  // Mobi 当前仅支持 Claude
    model?: string
    effort?: EffortLevel  // reasoning effort (low | medium | high | xhigh)
    outputStyle?: string  // CC output style（Default/Proactive/Concise/Explanatory/Learning 或自定义名）
    permissionMode?: PermissionMode
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    /** 归属工作区 id（Web spawn 透传；缺省 = 游离） */
    workspaceId?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
    | { type: 'already-running' }

// —— worktree 形状（executor 创建结果 ↔ 会话侧环境感知共用）——

export type WorktreeInfo = {
    basePath: string;
    worktreePath: string;
    branch: string;
    name: string;
    createdAt: number;
};

// —— session-started webhook（session → executor controlServer，Q3 spawn 判据）——

/** 会话自报端点路径（executor controlServer 与会话侧客户端共用单一来源） */
export const RUNNER_SESSION_STARTED_PATH = '/session-started'

/**
 * 会话自报请求体。注意 controlServer 侧校验刻意宽松（metadata 直传透传、
 * 不做 strip）——此类型只约束客户端构造侧；若未来收紧服务端校验，
 * 必须先核对 MetadataSchema 字段完整性（zod strip 会静默裁字段）。
 */
export interface SessionStartedWebhookBody {
    sessionId: string
    metadata: import('./schemas').Metadata
}
