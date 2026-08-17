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

import { randomUUID } from 'node:crypto'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/lib'

export interface PushUserMessageOpts {
    /** 本批消息的 mobi localId；空/缺省 = 注入路径（不绑定 native_id） */
    localIds?: string[]
    /** 绑定回调：push 成功后立即上报（uuid 在 push 前已确定，不依赖回显） */
    onBound?: (binding: { localIds: string[]; nativeId: string }) => void
}

/**
 * 统一的用户消息 push 入口：生成 nativeId（uuid v4）写入 SDKUserMessage.uuid——
 * SDK 采纳输入侧预设 uuid（回显与 transcript 均用它），push 那一刻
 * (localIds, nativeId) 配对即确定，立即经 onBound 上报。
 * 注意：text 须为已 sanitize 的最终文本，本函数不做内容处理。
 */
export function pushUserMessage(
    messages: { push: (msg: SDKUserMessage) => void },
    text: string,
    opts: PushUserMessageOpts = {},
): void {
    const nativeId = randomUUID()
    messages.push({
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: null,
        session_id: '',
        uuid: nativeId,
    })
    if (opts.localIds && opts.localIds.length > 0) {
        // 绑定上报失败必须就地吞掉：本函数的调用方（如 steer sink）在 try/catch 内
        // 调用并把异常视作 push 失败，会让 pushBack 把已送达 SDK 的消息重复投递。
        // 上报只是元数据绑定，失败了不值得回滚消息投递。
        try {
            opts.onBound?.({ localIds: opts.localIds, nativeId })
        } catch (e) {
            logger.warn('[pushUserMessage] 绑定上报失败（消息已投递，不回滚）:', e)
        }
    }
}
