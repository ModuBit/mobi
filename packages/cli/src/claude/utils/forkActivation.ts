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

import { logger } from '@/ui/logger'
import { scanTranscriptForUuid } from './transcriptScan'
import type { Metadata } from '@/api/types'

/**
 * fork 激活计划（fork-session spec §5.2）：待激活分叉会话首条消息触发时，
 * CLI 据此组装 resume + forkSession + resumeSessionAt + sessionId 四个 SDK option。
 * 由 fork 行 metadata.forkFrom（激活簿记）+ metadata.nativeSessionId（预生成 fork id）解析。
 */
export interface ForkActivationPlan {
    /** parent 当前 native session id（激活时作 resume） */
    parentNativeId: string
    /** 分叉锚点消息的 native id（激活时作 resumeSessionAt） */
    anchorNativeId: string
    /** fork 预生成 native id（激活时作 sessionId，与 fork 行 metadata.nativeSessionId 同值） */
    forkNativeId: string
}

/** fork 激活失败原因（错误态上报的 reason 区分，spec §5.3） */
export type ForkActivationFailureReason = 'anchor_gone' | 'resume_failed'

/** 激活预检结果——失败细分直接对齐 shared FORK_ERROR_CODES（web 按码映射文案） */
export type ForkPrecheckResult = 'ok' | 'anchor-invalidated' | 'parent-transcript-missing'

/**
 * 从 fork 行 metadata 解析激活计划：
 * - 无 forkFrom（普通会话 / 已激活）→ null，走正常 resume 路径
 * - forkFrom 存在但 metadata.nativeSessionId 缺失 → null（无法定位 fork 预生成 id，
 *   理论不可达——t03 建行时两者同点写入；防御降级为普通会话而非带病激活）
 */
export function resolveForkActivation(
    metadata: Pick<Metadata, 'forkFrom' | 'nativeSessionId'> | null | undefined,
): ForkActivationPlan | null {
    const forkFrom = metadata?.forkFrom
    if (!forkFrom) return null
    const forkNativeId = metadata?.nativeSessionId
    if (!forkNativeId) {
        logger.warn('[forkActivation] forkFrom 存在但 metadata.nativeSessionId 缺失，降级为普通会话')
        return null
    }
    return {
        parentNativeId: forkFrom.parentNativeId,
        anchorNativeId: forkFrom.anchorNativeId,
        forkNativeId,
    }
}

/**
 * 激活前预检（spec §5.2 步骤 3）：分页扫描 parent transcript，验证 anchorNativeId 仍在
 * （parent 可能已 rewind 深于锚点 / transcript 文件丢失——spec §5.3 前两行场景）。
 * 复用 scanTranscriptForUuid 共享骨架（与 findRewindAnchor 同一分页语义），
 * 只做存在性判定（fork 直接用 agent 回复 uuid 作 resumeSessionAt，无需向前换算
 * assistant 前驱）。失败细分：transcript 读取抛错 = 'parent-transcript-missing'；
 * 扫完未命中 = 'anchor-invalidated'（parent rewind 深于锚点的常态失败方向是
 * 「不激活」，不向上抛）。
 */
export async function verifyForkAnchorExists(
    parentNativeId: string,
    dir: string,
    anchorNativeId: string,
): Promise<ForkPrecheckResult> {
    try {
        return await scanTranscriptForUuid(parentNativeId, dir, anchorNativeId) === 'found'
            ? 'ok'
            : 'anchor-invalidated'
    } catch (e) {
        logger.debug(`[forkActivation] scan parent transcript failed`, e)
        return 'parent-transcript-missing'
    }
}

/**
 * fork 激活完成上报的 metadata 变换：清除激活簿记 forkFrom 与失败标记 forkError
 * （成功即抹掉历史失败——badge 解除、错误态消失），保留持久溯源 forkedFrom（终身保留，
 * 禁止再次 fork 的判据）。
 */
export function omitForkFrom(metadata: Metadata): Metadata {
    const { forkFrom: _forkFrom, forkError: _forkError, ...rest } = metadata
    return rest
}

/**
 * fork 激活失败的 metadata 叠加变换：保留 forkFrom（badge 不解除，删除守卫与待激活判定
 * 依赖其在场——shared FORK_ERROR_METADATA 契约），叠加 forkError 供 web 错误态渲染。
 * 与时间线错误消息（forkActivationFailureMessage）并行上报，一个给状态一个给阅读。
 */
export function withForkError(metadata: Metadata, code: string, detail?: string): Metadata {
    return { ...metadata, forkError: { code, at: Date.now(), ...(detail ? { detail } : {}) } }
}

/**
 * fork 激活失败的用户可见文案（经 sendSessionEvent 落时间线，错误态）。
 * 刻意英文：CLI 无 web i18n 通道，本地化展示由 forkError → web resolveForkErrorText
 * 按码映射承担（状态渠道）；时间线文案对齐 CC 系统消息与 messageBuffer 的英文惯例，
 * 避免同一失败出现中英两个漂移来源。anchor_gone 对齐 spec §5.3；resume_failed 附带细节。
 * 两种失败均保留 forkFrom（badge 不解除）：会话可删除，重发消息即重试。
 */
export function forkActivationFailureMessage(
    reason: ForkActivationFailureReason,
    detail?: string,
): string {
    if (reason === 'anchor_gone') {
        return 'Fork activation failed: the parent session was rewound past the fork anchor. You can delete this forked session, or go back to the parent session and fork again.'
    }
    return `Fork activation failed: failed to load the parent session (${detail ?? 'unknown reason'}). Resend a message to retry, or delete this forked session.`
}
