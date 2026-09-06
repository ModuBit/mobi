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

import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'
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

/** 正向分页每页条数（对齐 findRewindAnchor） */
const PAGE_SIZE = 50
/** 最大回扫页数（防病态长链死循环；50×40=2000 条 entry 覆盖常规会话） */
const MAX_PAGES = 40

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
 * 复用 findRewindAnchor 的分页思路但只做存在性判定（fork 直接用 agent 回复 uuid 作
 * resumeSessionAt，无需向前换算 assistant 前驱），命中即止。
 * 失败细分：transcript 读取抛错 = 'parent-transcript-missing'；扫完未命中 = 'anchor-invalidated'
 * （parent rewind 深于锚点的常态路径）。失败方向是「不激活」，不向上抛。
 */
export async function verifyForkAnchorExists(
    parentNativeId: string,
    dir: string,
    anchorNativeId: string,
): Promise<ForkPrecheckResult> {
    for (let page = 0; page < MAX_PAGES; page++) {
        let messages: Awaited<ReturnType<typeof getSessionMessages>>
        try {
            messages = await getSessionMessages(parentNativeId, { dir, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        } catch (e) {
            logger.debug(`[forkActivation] scan parent transcript failed at page=${page}`, e)
            return 'parent-transcript-missing'
        }
        if (messages.length === 0) {
            // 空页：transcript 已扫完（或文件不存在）仍未命中 → 预检失败
            logger.debug(`[forkActivation] anchor ${anchorNativeId} not in parent transcript (exhausted at page=${page})`)
            return 'anchor-invalidated'
        }
        if (messages.some(m => m.uuid === anchorNativeId)) return 'ok'
        if (messages.length < PAGE_SIZE) {
            // 末页不满：全量已扫完，锚点不存在
            return 'anchor-invalidated'
        }
    }
    // 超出回扫上限仍未命中：按锚点失效拒绝（防病态长链）
    logger.warn(`[forkActivation] exceeded MAX_PAGES (${MAX_PAGES}) without hitting ${anchorNativeId}`)
    return 'anchor-invalidated'
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
 * anchor_gone 对齐 spec §5.3 的「父会话已回退，分叉点失效」；resume_failed 附带细节。
 * 两种失败均保留 forkFrom（badge 不解除）：会话可删除，重发消息即重试。
 */
export function forkActivationFailureMessage(
    reason: ForkActivationFailureReason,
    detail?: string,
): string {
    if (reason === 'anchor_gone') {
        return '分叉激活失败：父会话已回退，分叉点失效。可删除该分叉会话，或回到父会话重新分叉。'
    }
    return `分叉激活失败：父会话加载失败（${detail ?? '未知原因'}）。可重发消息重试，或删除该分叉会话。`
}
