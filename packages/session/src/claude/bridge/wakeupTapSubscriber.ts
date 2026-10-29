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

// wakeup 订阅者（bridge 通道第二个消费者，wakeup-source spec mods 路线）：
// 收到 prompt 信号（mods 事件层无 wakeupSource——session.append 是落盘序列化前的
// 输入，形状 {message,door,origin,uuid}，唤醒行事件与人工 prompt 元数据完全同形，
// 故生产端只能宽触发）→ 尾部窗口扫读落盘行 → 按行顶层 wakeupSource 权威判定
// （人工 prompt 行无该字段天然排除；枚举外取值静默放弃）→ 解析值交回调
// （票 01 上报链路：runtimeState.lastWakeup + session event 落库）。
// 与 goal 订阅者的关键差异：**不透传原始行**——SDK 流本就不透传唤醒注入的 user
// 消息，消息流不该凭空多 user 行；唤醒只作为事实（系统行）呈现。
// 订阅机制（退避/补偿/去重/串行化）在 transcriptTapSubscriber 统一收口；
// 窗口耗尽档位取 debug——人工 prompt 信号高频，未见目标行多为无价值场景。

import { TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE, WakeupSourceSchema, type WakeupSource } from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';
import { registerTranscriptTapSubscriber } from './transcriptTapSubscriber';

export interface WakeupTapSubscriberOptions {
    /** 当前会话 transcript 路径解析（sessionId 未就绪返回 null，信号丢弃并 warn） */
    resolveTranscriptPath: () => string | null;
    /** 解析出的唤醒来源出口（调用方接票 01 上报链路） */
    onWakeup: (source: WakeupSource) => void;
}

/**
 * 注册订阅者，返回停用函数（透传自通用机制）。
 */
export function registerWakeupTapSubscriber(bridge: BridgeListener, opts: WakeupTapSubscriberOptions): () => void {
    return registerTranscriptTapSubscriber(bridge, {
        envelope: TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE,
        tag: 'BRIDGE_WAKEUP',
        // 唤醒行低频，容量收紧（防 rewind/compact 重写极端场景无界增长）
        maxSeenUuids: 500,
        // 严格模式：只认 uuid 与信号一致的行 + 不排补偿波。wakeup 事件 {sid, source}
        // 无 uuid、daemon/web 无法去重，宽扫/补偿在进程重启后会把重启前旧唤醒行当新行
        // 重报（假系统行 + lastWakeup 错误归因）；代价是 mod 出口丢信号时该行漏报（罕见，
        // 行仍在 transcript 可对账）
        signalRowExactMatch: true,
        resolveTranscriptPath: opts.resolveTranscriptPath,
        handleRow: (row) => {
            // 枚举外的取值（CC 未来扩展）safeParse 失败静默放弃——daemon 不认识的不报
            const source = WakeupSourceSchema.safeParse(row.wakeupSource);
            if (!source.success) return false;
            opts.onWakeup(source.data);
            return true;
        },
        onMissed: (signalUuid, filePath) =>
            logger.debug(`[BRIDGE_WAKEUP] no wakeup row consumed within tail window: uuid=${signalUuid} file=${filePath}`),
    });
}
