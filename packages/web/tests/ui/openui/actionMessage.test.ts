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
 * OpenUI ActionEvent → 用户消息文本组装规格（generative-ui 票 03）：
 * - 仅 continue_conversation 进入组装（open_url 等其他类型不属于回路②）；
 * - humanFriendlyMessage 作文本主体（@ToAssistant 的 message / Button label）；
 * - 命名表单嵌套 formState 展开内层字段并带表名表头；
 * - 无名快照 formState 顶层平铺；对象值 JSON 保持结构；
 * - 无内容（空 label + 无 formState）返回 null 不发送。
 */

import { describe, it, expect } from 'vitest'
import { buildOpenUIMessage } from '@/ui/openui/actionMessage'

describe('buildOpenUIMessage（回路② 消息组装）', () => {
    it('@ToAssistant message + 命名表单嵌套 formState → 主体 + 表名表头 + 内层字段', () => {
        const text = buildOpenUIMessage({
            type: 'continue_conversation',
            humanFriendlyMessage: '提交订票',
            formName: 'contact',
            formState: { contact: { name: '林墨墨', size: '大杯' } },
        })
        expect(text).toBe(
            '提交订票\n\n表单「contact」当前值：\n- name: 林墨墨\n- size: 大杯',
        )
    })

    it('无 formState 的 Button label → 纯文本主体', () => {
        const text = buildOpenUIMessage({
            type: 'continue_conversation',
            humanFriendlyMessage: '查看详情',
        })
        expect(text).toBe('查看详情')
    })

    it('无名 formState（store 快照）→ 顶层平铺，对象值 JSON 保持结构；$ 前缀键（宿主机制变量）不进文本', () => {
        const text = buildOpenUIMessage({
            type: 'continue_conversation',
            humanFriendlyMessage: '应用筛选',
            formState: { sort: 'desc', tags: ['a', 'b'], $actionState: 'idle' },
        })
        expect(text).toContain('UI 当前值：')
        expect(text).toContain('- sort: desc')
        expect(text).toContain('- tags: ["a","b"]')
        expect(text).not.toContain('$actionState')
    })

    it('react-ui 表单字段 { value: X } 包裹形态解包（E2E 实测 name: {"value":"林墨墨"}）', () => {
        const text = buildOpenUIMessage({
            type: 'continue_conversation',
            humanFriendlyMessage: '提交表单',
            formName: 'infoForm',
            formState: { infoForm: { name: { value: '林墨墨' }, city: { value: 'beijing' } } },
        })
        expect(text).toContain('- name: 林墨墨')
        expect(text).toContain('- city: beijing')
    })

    it('非 continue_conversation（open_url）不属于回路② → null', () => {
        expect(buildOpenUIMessage({
            type: 'open_url',
            humanFriendlyMessage: '',
            params: { url: 'https://example.com' },
        })).toBeNull()
    })

    it('空 label 且无 formState → null 不发送', () => {
        expect(buildOpenUIMessage({ type: 'continue_conversation', humanFriendlyMessage: '  ' })).toBeNull()
        expect(buildOpenUIMessage({
            type: 'continue_conversation',
            humanFriendlyMessage: '',
            formState: {},
        })).toBeNull()
    })
})
