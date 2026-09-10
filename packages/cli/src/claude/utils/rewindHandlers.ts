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

import { logger } from '@/ui/logger';
import { findRewindAnchor } from './rewindAnchor';
import type { QueryRestartController } from './queryRestart';
import type { EnhancedMode, QueryControlRef } from '../types';
import type { MessageQueue } from '@/utils/MessageQueue';

/**
 * rewind RPC 依赖的会话视图（Session 的结构子集——结构化依赖便于单测替身，
 * 也让本模块不反向依赖 Session 全量构造）
 */
export interface RewindSessionView {
    /** 当前 native session id（transcript 所在链；未知时 rewind 不可达） */
    sessionId: string | null;
    /** 前台 turn 是否运行中（闸门） */
    running: boolean;
    /** 重启协调 module：拥有 pending、异步准备占位、队列清理和退出哨兵。 */
    restart: QueryRestartController;
}

export interface RewindHandlerDeps {
    rpcManager: { registerHandler: (method: string, handler: (params: unknown) => Promise<unknown>) => void };
    /** 取当前 Session 视图（loop 创建后经 onSessionReady 回填，回填前为 null） */
    getRewindSession: () => RewindSessionView | null;
    messageQueue: MessageQueue<EnhancedMode>;
    /** SDK Query 控制引用（rewindFiles 需要 running query 句柄） */
    queryControl: QueryControlRef;
    /** 工作目录（getSessionMessages 的 dir） */
    workingDirectory: string;
}

/** 锚点换算失败（假锚点 / 链首）的拒绝文案——链首场景带 /clear 引导 */
const ANCHOR_REJECT_REASON =
    'rewind anchor not found in transcript (cannot rewind the first message of a session — use /clear instead)';

/** rewind 已在途的 busy 拒绝文案（Web 据此映射「回退正在进行中」提示） */
const REWIND_IN_PROGRESS_REASON = 'rewind is already in progress';

/** 校验 rewind 载荷中的 nativeId（用户消息 native uuid） */
function parseNativeId(payload: unknown): string {
    const { nativeId } = (payload ?? {}) as { nativeId?: unknown };
    if (typeof nativeId !== 'string' || nativeId.length === 0) {
        throw new Error('rewind requires non-empty nativeId string');
    }
    return nativeId;
}

/**
 * 注册 rewind 两个 RPC handler（Web → Hub → CLI，对齐 rename-session 模式）：
 *
 * - `rewind-dry-run`：预检。锚点存在性（getSessionMessages，假锚点/换链旧行 → 拒绝）
 *   + rewindFiles dryRun（file checkpoint 可达性）
 * - `rewind`：执行。闸门复检（队列/running，放行侧唯一权威——Hub 只查了后台任务）→
 *   锚点复检 → 文件回滚（**先于截断**：PoC poc8 实测截断后被截区间的 checkpoint 立即
 *   作废，截断前调用才有效）→ 向 restart module 提交 rewind 请求 → 退出当前 query；
 *   受理即返 `{ accepted: true }`，结果经 socket 两段回报
 *   （rewind-truncated / rewind-completed，launcher 截断轮完成后发出）。
 *
 * 失败语义（PoC 定案）：
 * - 文件回滚失败（截断未发生）→ 干净失败：不同步截断/清队列，同步返回
 *   `{ accepted: false, reason }`，Web toast 原因即可
 * - 文件回滚成功、截断失败 → 如实经 rewind-completed { filesRestored: true, error } 上报
 *   （发生率低；SDK checkpointing 会在下轮注入 attachment 告知模型磁盘真相）
 */
export function registerRewindHandlers(deps: RewindHandlerDeps): void {
    const { rpcManager, getRewindSession, messageQueue, queryControl, workingDirectory } = deps;

    rpcManager.registerHandler('rewind-dry-run', async (payload: unknown) => {
        const nativeId = parseNativeId(payload);
        const session = getRewindSession();
        if (!session?.sessionId) {
            return { canRewind: false, canRestoreFiles: false, reason: 'native session id is unknown' };
        }

        // 重启通道在途（受理中 / 槽非空——含 output style 请求）→ 直接 busy 拒绝：跳过锚点预检
        // 省一次 transcript 读取，另一端连确认弹窗都不该弹出（Web 按 reason 映射「回退正在进行中」提示）
        if (session.restart.busy) {
            return { canRewind: false, canRestoreFiles: false, reason: REWIND_IN_PROGRESS_REASON };
        }

        // 锚点存在性预检（假锚点/换链旧行不在当前 transcript chain → null）
        const resumeAt = await findRewindAnchor(session.sessionId, workingDirectory, nativeId);
        if (!resumeAt) {
            return { canRewind: false, canRestoreFiles: false, reason: ANCHOR_REJECT_REASON };
        }

        // rewindFiles dryRun 需要 running query 句柄（RPC 到 claude 进程读 checkpoint）；
        // 句柄不可达（query 轮间隙）时保守 canRestoreFiles: true——放行侧由执行阶段的
        // 真实调用裁决，部分失败降级语义（"仅回退对话"）已覆盖
        try {
            const dry = await queryControl.current?.rewindFiles(nativeId, { dryRun: true });
            return { canRewind: true, canRestoreFiles: dry?.canRewind ?? true };
        } catch (e) {
            logger.debug('[rewind] dry-run rewindFiles unavailable, defaulting canRestoreFiles=true', e);
            return { canRewind: true, canRestoreFiles: true };
        }
    });

    rpcManager.registerHandler('rewind', async (payload: unknown) => {
        const nativeId = parseNativeId(payload);
        const restoreFiles = (payload as { restoreFiles?: unknown }).restoreFiles === true;
        const session = getRewindSession();
        if (!session) {
            return { accepted: false, reason: 'session is not ready' };
        }
        if (!session.sessionId) {
            return { accepted: false, reason: 'native session id is unknown' };
        }
        const sessionId = session.sessionId;

        // tryPrepare 在回调执行前同步占位并在所有拒绝/异常路径自动释放；ready 时由 module
        // 原子完成「pending 置位 → 清排队 → 哨兵入队」，调用方不再接触重启协议状态。
        const result = await session.restart.tryPrepare(async () => {
            // 闸门复检（Hub 已查后台任务集合）：队列非空 / 前台运行中 → 拒绝
            if (messageQueue.size() > 0) {
                return { ready: false, reason: 'message queue is not empty' };
            }
            if (session.running) {
                return { ready: false, reason: 'session is running' };
            }

            // 锚点复检（与 dry-run 同源；受理窗口内 transcript 可能已变）
            const resumeAt = await findRewindAnchor(sessionId, workingDirectory, nativeId);
            if (!resumeAt) {
                return { ready: false, reason: ANCHOR_REJECT_REASON };
            }

            // 文件回滚先于截断（PoC poc8 实测：截断后被截区间的 file checkpoint 立即作废，
            // 截断前调用才有效）。失败 → 干净失败：不截断、不清队列
            let filesRestored = false;
            let skippedLinks: number | undefined;
            if (restoreFiles) {
                const query = queryControl.current;
                if (!query) {
                    return { ready: false, reason: 'claude query handle unavailable for file restore' };
                }
                try {
                    const result = await query.rewindFiles(nativeId);
                    if (!result.canRewind) {
                        return {
                            ready: false,
                            reason: `file restore unavailable: ${result.error ?? 'file checkpoint missing'}`
                        };
                    }
                    filesRestored = true;
                    skippedLinks = result.skippedLinks;
                } catch (e) {
                    return { ready: false, reason: `file restore failed: ${e instanceof Error ? e.message : String(e)}` };
                }
            }

            return {
                ready: true,
                request: { kind: 'rewind', nativeId, resumeAt, filesRestored, skippedLinks },
            };
        });

        if (result === null) {
            return { accepted: false, reason: REWIND_IN_PROGRESS_REASON };
        }
        return result;
    });
}
