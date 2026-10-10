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
 * 档③原地更新生命周期（架构评审候选 5）：消息窗口 → 终态扫描 → store 推进的
 * 接线收口。此前这段 effect 住在 ChatContainer——$actionState 的完整生命周期因此
 * 横跨容器与 openui 目录两处；收进本 hook 后，档③的全部 web 侧逻辑（renderer 订阅 /
 * store / 扫描派生 / 本接线）同居 components/ui/openui/ 一个目录。
 *
 * ChatContainer 只负责喂数据（消息窗口 + 会话运行态），不感知扫描细节。
 */

import { useEffect } from 'react'
import type { DecryptedMessage } from '@/core/data/api/types'
import { deriveOpenUITerminalStates } from './actionState'
import { useOpenUIActionStore } from './actionStore'

export function useOpenUIActionLifecycle(
    messages: readonly DecryptedMessage[],
    isSessionRunning: boolean,
): void {
    // 从消息窗口派生各锚点的 done/failed/running，批量推进 actionStore。点击即时翻转
    // 的 running 与扫描合成（applyDerived 幂等）；刷新后的状态恢复也走这里（锚点随
    // 消息 meta 落库）。messages 窗口 / running 任一变化重扫
    useEffect(() => {
        const derived = deriveOpenUITerminalStates(messages, isSessionRunning)
        if (derived.size > 0) {
            useOpenUIActionStore.getState().applyDerived(derived)
        }
    }, [messages, isSessionRunning])
}
