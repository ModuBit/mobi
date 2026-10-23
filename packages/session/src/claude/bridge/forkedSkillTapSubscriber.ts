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

// forked skill tap 订阅者（spec forked-code-review-tap，bridge 第二个消费者）：
// mod 只推最小事实（skill / uuid / door / message），「主对话行」的业务形状只在
// 这里出现——补齐 uuid / sessionId / timestamp / isSidechain，然后交给与 claude
// query 消息同一条管道（daemon 按普通主对话消息落库与广播，不感知 fork）。
//
// 刻意不带 parent_tool_use_id / agentId / isMeta：这些字段会把行归入 sidechain /
// agent 视图，而本特性的语义正是「fork 的执行过程当作主对话呈现」。
//
// 流侧去重：拼行成功即把 uuid 记入会话级集合（见 forkedSkillTapState），SDK 流末尾
// 的批量重放据此丢弃；坏载荷静默跳过，不影响通道与其他订阅者。

import {
    FORKED_SKILL_TAP_ENVELOPE_TYPE,
    FORKED_SKILL_TAP_SKILL,
    ForkedSkillAppendPayloadSchema,
    type ForkedSkillAppendPayload,
} from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';
import { hasLiveRowUuid, rememberLiveRowUuid } from './forkedSkillTapState';
import { RawJSONLinesSchema, type RawJSONLines } from '../types';

export interface ForkedSkillTapSubscriberOptions {
    /** 当前会话 id（拼行补 sessionId；未就绪返回 null，该行丢弃并 debug） */
    resolveSessionId: () => string | null;
    /** 主对话行出口：与 claude query 消息同一落库广播路径 */
    sendMessage: (message: RawJSONLines) => void;
}

/**
 * 注册订阅者，返回停用函数（会话退出时调用）。停用后不再拼行/转发；
 * 已记入去重集合的 uuid 保留（进程随之退出，无需清理）。
 */
export function registerForkedSkillTapSubscriber(
    bridge: BridgeListener,
    opts: ForkedSkillTapSubscriberOptions,
): () => void {
    let stopped = false;

    bridge.subscribe(FORKED_SKILL_TAP_ENVELOPE_TYPE, (payload) => {
        if (stopped) return;
        const parsed = ForkedSkillAppendPayloadSchema.safeParse(payload);
        if (!parsed.success) {
            logger.debug('[BRIDGE_FORKED_TAP] invalid payload dropped', parsed.error.message);
            return;
        }
        const signal = parsed.data;
        // 单源校验后仍防御：会话侧不重新识别 fork，只认 mod 推来的 skill
        if (signal.skill !== FORKED_SKILL_TAP_SKILL) return;
        forwardRow(signal, opts, stopped);
    });

    return () => {
        stopped = true;
    };
}

/** 拼主对话行并入管道；行形状不过 schema 校验即静默跳过（坏载荷不影响通道） */
function forwardRow(
    signal: ForkedSkillAppendPayload,
    opts: ForkedSkillTapSubscriberOptions,
    stopped: boolean,
): void {
    if (stopped) return;
    // 重复信号（mod 重试 / 通道重投）：实时行只落一次
    if (hasLiveRowUuid(signal.uuid)) return;
    const sessionId = opts.resolveSessionId();
    if (!sessionId) {
        logger.debug(`[BRIDGE_FORKED_TAP] session id unavailable, dropping row uuid=${signal.uuid}`);
        return;
    }
    if (signal.truncated) {
        logger.debug(`[BRIDGE_FORKED_TAP] truncated message forwarded uuid=${signal.uuid}`);
    }
    const row = {
        type: (signal.message as { type?: unknown }).type,
        uuid: signal.uuid,
        message: signal.message,
        sessionId,
        timestamp: new Date().toISOString(),
        isSidechain: false,
    };
    const parsed = RawJSONLinesSchema.safeParse(row);
    if (!parsed.success) {
        logger.debug(`[BRIDGE_FORKED_TAP] row failed schema validation, dropped uuid=${signal.uuid}`, parsed.error.message);
        return;
    }
    // 发送原始行而非 schema 解析产物：解析会 strip 未显式声明的字段（message.type 等），
    // 而目标行应与 transcript 行同形，不做字段裁剪
    // 先发送再记入去重集合：同步抛出时不把「没送达的行」也标记成已消费，
    // 否则流侧会把该行一并抑制（宁可流侧兜底一次，不丢内容）
    try {
        opts.sendMessage(row as RawJSONLines);
    } catch (e) {
        logger.warn(`[BRIDGE_FORKED_TAP] send failed for uuid=${signal.uuid}`, e);
        return;
    }
    rememberLiveRowUuid(signal.uuid);
}
