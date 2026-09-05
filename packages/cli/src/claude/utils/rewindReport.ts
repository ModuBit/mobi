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
import type { PendingRewind } from '../types';

/** rewind 两段回报依赖的 client 视图（ApiSessionClient 的结构子集，便于单测替身） */
export interface RewindReportClient {
    /** 反查锚点批首行 seq（Hub 软删除定界） */
    fetchRewindBoundary(nativeId: string): Promise<number>
    /** 截断成功上报（Hub 即刻软删除 + 转 SSE） */
    emitRewindTruncated(nativeId: string, deleteFromSeq: number): void
    /** 终态上报（Web 解禁输入 / 关闭弹窗的完成标志）；skippedLinks>0 时部分路径被安全护栏跳过 */
    emitRewindCompleted(filesRestored: boolean, error?: string, skippedLinks?: number): void
}

/**
 * rewind 截断轮完成后的两段回报（截断已生效时由 launcher 调用）：
 *
 * 1. `rewind-truncated`（含 deleteFromSeq = 锚点批首行 seq，1:N 批整批同删的定界）
 *    → Hub 即刻软删除并转 SSE，Web 先显示过渡态
 * 2. `rewind-completed`（含 filesRestored）→ 终态，Web 清理窗口 / 回填 sender / 解禁输入
 *
 * 文件回滚结果（filesRestored）在 rewind RPC 受理阶段已确定（先于截断执行——截断后
 * checkpoint 作废，PoC poc8 实测），此处只携带上报。
 *
 * 边界反查失败（fetchRewindBoundary 抛错 / 返回 0，如 Hub 行已删或 DTO 未含 metadata）：
 * 跳过 truncated 上报（不能拿 0 去软删除全量），completed 携带 error 收尾——Web 的
 * 30s 超时兜底之外再给一个明确终态。
 */
export async function reportRewindCompletion(
    client: RewindReportClient,
    rewind: PendingRewind,
): Promise<void> {
    let filesError: string | undefined;

    try {
        const deleteFromSeq = await client.fetchRewindBoundary(rewind.nativeId);
        if (deleteFromSeq > 0) {
            client.emitRewindTruncated(rewind.nativeId, deleteFromSeq);
        } else {
            logger.warn(`[rewindReport] boundary not found for ${rewind.nativeId}, skipping truncated report`);
            filesError = 'rewind boundary not found on hub';
        }
    } catch (e) {
        logger.warn('[rewindReport] fetchRewindBoundary failed', e);
        filesError = `rewind boundary lookup failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    client.emitRewindCompleted(rewind.filesRestored, filesError, rewind.skippedLinks);
}
