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
 * 模型切换时间线事件族的单一契约（shared/modelChangeLine）：
 * wire 形状、写库分类、读路径可见性在同一处锁定，消费方不再各自维护字符串。
 */

import { describe, it, expect } from 'vitest'
import { buildModelChangeLine, MODEL_CHANGE_EVENT_TYPE, parseModelChangeLine } from '../src/modelChangeLine'
import { classifyMessage, isClaudeChatVisibleMessage } from '../src/messageClassification'

describe('modelChangeLine codec', () => {
    it('合成端形状：system + model_change + 快照模型 + uuid', () => {
        expect(buildModelChangeLine({ model: 'opus', uuid: 'u-1' })).toEqual({
            type: 'system',
            subtype: 'model_change',
            model: 'opus',
            uuid: 'u-1',
        })
    })

    it('解析：完整行取 model，扩展字段透传不报错', () => {
        const line = parseModelChangeLine({ type: 'system', subtype: 'model_change', model: 'sonnet', uuid: 'u-2', extra: 1 })
        expect(line).toEqual({ model: 'sonnet' })
    })

    it('解析：非本事件 / 缺模型 / 空模型 → null（web normalize 据此丢行）', () => {
        expect(parseModelChangeLine({ type: 'system', subtype: 'turn_duration', durationMs: 1 })).toBeNull()
        expect(parseModelChangeLine({ type: 'system', subtype: 'model_change' })).toBeNull()
        expect(parseModelChangeLine({ type: 'system', subtype: 'model_change', model: '' })).toBeNull()
        expect(parseModelChangeLine(null)).toBeNull()
    })

    it('写库分类与读路径可见性由同一契约锁定（persistent + 可见）', () => {
        expect(classifyMessage('system', 'model_change')).toBe('persistent')
        expect(isClaudeChatVisibleMessage({ type: 'system', subtype: 'model_change' })).toBe(true)
    })

    it('web 事件判别串与 wire subtype 有意不同形，各自单一来源', () => {
        expect(MODEL_CHANGE_EVENT_TYPE).toBe('model-change')
    })
})
