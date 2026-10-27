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
import { buildModelSelectOptions } from '@/domain/session/modelSelectOptions'
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
