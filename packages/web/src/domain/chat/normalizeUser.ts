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

import { normalizeUserContent } from '@mobi/shared'
import type { NormalizedMessage, MessageMeta } from './types'

/**
 * user 消息读取侧归一：四形态（string / 旧平铺 / 单 block / 数组）统一收敛为
 * UserContentBlock[]，归一逻辑单一来源在 @mobi/shared 的 normalizeUserContent。
 * 畸形/空输入返回 null（由 normalize.ts 走 JSON dump 兜底）。
 */
export function normalizeUserRecord(
    messageId: string,
    localId: string | null,
    createdAt: number,
    content: unknown,
    meta?: MessageMeta
): NormalizedMessage | null {
    const blocks = normalizeUserContent(content)
    if (!blocks) return null
    return {
        id: messageId,
        localId,
        createdAt,
        role: 'user',
        content: { type: 'text', text: '', blocks },
        isSidechain: false,
        meta
    }
}
