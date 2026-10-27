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
 * 模型下拉选项单一来源：探针清单 → 选项的构建规则与兜底
 */

import { describe, it, expect } from 'vitest'
import { buildModelSelectOptions, reconcileStoredModel } from '@/domain/session/modelSelectOptions'
import type { ModelInfo } from '@mobi/shared'

function model(overrides: Partial<ModelInfo> & { value: string }): ModelInfo {
    return {
        displayName: overrides.value,
        description: '',
        ...overrides,
    }
}

describe('buildModelSelectOptions', () => {
    it('探针未就绪/失败时回落兜底四项', () => {
        expect(buildModelSelectOptions(undefined).map(o => o.value)).toEqual(['auto', 'opus', 'sonnet', 'haiku'])
        expect(buildModelSelectOptions(null).map(o => o.value)).toEqual(['auto', 'opus', 'sonnet', 'haiku'])
        expect(buildModelSelectOptions([]).map(o => o.value)).toEqual(['auto', 'opus', 'sonnet', 'haiku'])
    })

    it('探针清单含 auto 时原样使用，不重复合成', () => {
        const options = buildModelSelectOptions([
            model({ value: 'auto', displayName: 'Default (recommended)' }),
            model({ value: 'sonnet', displayName: 'Sonnet' }),
        ])
        expect(options.map(o => o.value)).toEqual(['auto', 'sonnet'])
    })

    it('探针清单不含 auto 时把 auto 合成到首位，其余顺序不变', () => {
        const options = buildModelSelectOptions([
            model({ value: 'proxy-a', displayName: 'Proxy A' }),
            model({ value: 'opus', displayName: 'Opus' }),
        ])
        expect(options.map(o => o.value)).toEqual(['auto', 'proxy-a', 'opus'])
    })

    it('代理/自建模型名与描述原样带出（可被选中）', () => {
        const options = buildModelSelectOptions([
            model({ value: 'deepseek-v3', displayName: 'DeepSeek V3', description: '网关模型' }),
        ])
        const entry = options.find(o => o.value === 'deepseek-v3')
        expect(entry).toMatchObject({ label: 'DeepSeek V3', description: '网关模型' })
    })

    it('短名剥掉尾部括注（触发器窄容器用）', () => {
        const options = buildModelSelectOptions([
            model({ value: 'opus[1m]', displayName: 'Opus 4.6 (1M context)' }),
        ])
        expect(options.find(o => o.value === 'opus[1m]')?.label).toBe('Opus 4.6')
    })
})

describe('reconcileStoredModel', () => {
    const catalog = [model({ value: 'auto' }), model({ value: 'claude-opus-5-5' })]

    it('目录里有该值 → 原样保留', () => {
        expect(reconcileStoredModel('claude-opus-5-5', catalog)).toBe('claude-opus-5-5')
    })

    it('老版本存的预设别名（opus）不在目录里 → 回 auto', () => {
        // model-catalog 之前的偏好值是 `opus` 这类 CLI 别名，宿主目录只给完整模型名：
        // 不校正的话 pill 会一直裸显 `opus`，用户既选不到也改不掉
        expect(reconcileStoredModel('opus', catalog)).toBe('auto')
        expect(reconcileStoredModel('sonnet[1m]', catalog)).toBe('auto')
    })

    it('目录为空（探针未就绪 / 失败）→ 原样保留，不清掉显式选择', () => {
        expect(reconcileStoredModel('opus', undefined)).toBe('opus')
        expect(reconcileStoredModel('opus', null)).toBe('opus')
        expect(reconcileStoredModel('opus', [])).toBe('opus')
    })
})
