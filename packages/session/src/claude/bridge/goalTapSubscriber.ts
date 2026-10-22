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

// goal 订阅者（bridge 通道第一个消费者，spec mods-goal-channel）。
// 票 01：先以日志订阅者验证 goal_status 信号穿桥（door/name/uuid 可见）；
// 票 02：替换为尾部窗口读取——从 transcript 读出原始行透传进消息管道，本文件随之演进。

import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';

/** 信号载荷形状（mod 生产端约定：仅元数据，无内容） */
export interface SessionAppendSignal {
    door?: string;
    name?: string;
    uuid?: string;
}

export function registerGoalTapSubscriber(bridge: BridgeListener): void {
    bridge.subscribe('session.append', (payload) => {
        const signal = payload as SessionAppendSignal;
        logger.debug(`[BRIDGE_GOAL] goal_status signal: door=${signal.door} name=${signal.name} uuid=${signal.uuid}`);
    });
}
