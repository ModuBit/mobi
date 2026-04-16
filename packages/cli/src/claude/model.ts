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

import type { SessionModel } from '@/api/types'

/**
 * 规范化 Claude 会话模型
 * - 如果模型为空或未指定，返回 null（使用默认模型）
 * - 否则返回原始模型字符串
 */
export function normalizeClaudeSessionModel(model: string | undefined): SessionModel {
    if (!model || !model.trim()) {
        return null
    }
    return model.trim()
}
