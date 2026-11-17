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

// 模型选择的会话侧翻译（normalizeClaudeSessionModel）：mobi 哨兵 → CC 模型值。
// 回归背景：切回 Auto 时 setModel('auto') 被 CC 的 set_model 校验拒绝（非模型 id），
// live 切换静默不落地且不落时间线行——哨兵必须在进入 SDK 之前翻译成 CC 的 default 别名。
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL } from '@mobi/shared'
import { CLAUDE_DEFAULT_MODEL_ALIAS, normalizeClaudeSessionModel } from '@/claude/model'

describe('normalizeClaudeSessionModel', () => {
    it('mobi 哨兵 auto → CC 的 default 别名（首尾空白一并归一）', () => {
        expect(DEFAULT_MODEL).toBe('auto')
        expect(normalizeClaudeSessionModel(DEFAULT_MODEL)).toBe(CLAUDE_DEFAULT_MODEL_ALIAS)
        expect(normalizeClaudeSessionModel(`  ${DEFAULT_MODEL}  `)).toBe(CLAUDE_DEFAULT_MODEL_ALIAS)
    })

    it('CC 的 default 别名原样保留（幂等，可经 DB 回环）', () => {
        expect(normalizeClaudeSessionModel(CLAUDE_DEFAULT_MODEL_ALIAS)).toBe(CLAUDE_DEFAULT_MODEL_ALIAS)
    })

    it('未指定 / 空串 / 纯空白 → null（不传 model，由 CC 默认兜底）', () => {
        expect(normalizeClaudeSessionModel(undefined)).toBeNull()
        expect(normalizeClaudeSessionModel('')).toBeNull()
        expect(normalizeClaudeSessionModel('   ')).toBeNull()
    })

    it('真实模型 id 去空白后原样返回', () => {
        expect(normalizeClaudeSessionModel(' ccs-claude-zhipu--glm-5.3[1M] ')).toBe('ccs-claude-zhipu--glm-5.3[1M]')
    })
})
