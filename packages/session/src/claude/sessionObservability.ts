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
 * 会话观测三件套工厂（架构评审候选⑦）：goal 状态处理器与轮次变更合成器
 * 的单一装配点，local/remote 双 launcher 共用。
 *
 * 此前同一批构造在 claudeLocalLauncher / claudeRemoteLauncher 各装配一遍
 * （含注释），仅 turnDiff 的发送路径不同（local 直发 vs remote 经
 * OutgoingMessageQueue 入列保 FIFO）——发送 adapter 是双模间唯一的真 seam，
 * 以 turnDiffSend 参数注入；其余构造逐字同源。scanner 的接线（eager vs
 * 惰性 promise / onMessage 顺序编排）是真差异，留在各自 launcher。
 */

import type { ApiSessionClient } from "../api/apiSession";
import type { RawJSONLines } from "./types";
import { GoalStatusHandler } from "./goalStatusHandler";
import { TurnDiffReporter } from "./turnDiffReporter";
import { FileTurnArchiveStore, getTurnArchivePath } from "@mobi/node-core/git/turnArchiveStore";
import { FileTurnFulltextStore, getTurnFulltextRoot } from "@mobi/node-core/git/turnFulltextStore";

export type SessionObservability = {
    /** goal 状态处理器：scanner 提取 goal_status attachment 后双发（reportGoalStatus RPC + goal_progress 聊天消息） */
    goalHandler: GoalStatusHandler
    /** 轮次变更合成器（ADR 0008 / turn-archive B）：归档封口 + 投影降级 */
    turnDiffReporter: TurnDiffReporter
}

/**
 * 装配会话观测三件套。
 *
 * @param client 会话通道（goal 双发与归档路径的 sessionId 来源）
 * @param turnDiffSend 轮次变更合成消息的发送 adapter——双模唯一差异点：
 *   local 直发 sendClaudeSessionMessage；remote 经转换链入列（FIFO，卡片排在
 *   result 与延迟中的 assistant 消息之后）
 */
export function createSessionObservability(
    client: ApiSessionClient,
    turnDiffSend: (raw: RawJSONLines) => void,
    path: string,
): SessionObservability {
    // goal 双发恒走通道直发（不经队列：goal_progress 不参与 FIFO 时间线）
    const goalHandler = new GoalStatusHandler(client, (m) => client.sendClaudeSessionMessage(m));

    // turn 封口归档（历史轮回看的事实源）：构造零 I/O，封口失败不阻塞。
    // 全文目录存储（hydration）：封口落 a/b 全文 + 归档带 ref
    const turnArchive = new FileTurnArchiveStore(getTurnArchivePath(path, client.sessionId));
    const turnFulltext = new FileTurnFulltextStore(getTurnFulltextRoot(path, client.sessionId), path);
    const turnDiffReporter = new TurnDiffReporter(turnDiffSend, turnArchive, turnFulltext);

    return { goalHandler, turnDiffReporter };
}
