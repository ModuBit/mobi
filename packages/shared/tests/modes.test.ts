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

import { describe, it, expect } from 'vitest'
import {
    EFFORT_LEVELS,
    EFFORT_SESSION_LEVELS,
    EFFORT_LABELS,
    resolveModelEffortLevels,
    reconcileSessionConfigForModel,
    type EffortLevel,
    PERMISSION_MODES,
    CLAUDE_PERMISSION_MODES,
    PERMISSION_MODE_LABELS,
    PERMISSION_MODE_TONES,
    type PermissionMode,
    type PermissionModeTone
} from '../src/modes'
import { RuntimeStateSchema } from '../src/schemas'

describe('EFFORT_LEVELS', () => {
    it('可落盘档位包含四个级别（max 不落盘）', () => {
        expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh'])
    })

    it('会话档位 = 可落盘四档 + max', () => {
        expect(EFFORT_SESSION_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    })

    it('EffortLevel 类型支持含 max 的有效字符串字面量', () => {
        const valid: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
        expect(valid).toHaveLength(5)
    })
})

describe('resolveModelEffortLevels', () => {
    it('无模型信息时回落四档', () => {
        expect(resolveModelEffortLevels(undefined)).toEqual(['low', 'medium', 'high', 'xhigh'])
        expect(resolveModelEffortLevels(null)).toEqual(['low', 'medium', 'high', 'xhigh'])
    })

    it('模型声明不支持 effort 时返回空集合', () => {
        expect(resolveModelEffortLevels({ supportsEffort: false, supportedEffortLevels: ['low'] })).toEqual([])
    })

    it('按 supportedEffortLevels 过滤并保持由低到高的规范顺序', () => {
        expect(resolveModelEffortLevels({ supportedEffortLevels: ['xhigh', 'low', 'medium'] }))
            .toEqual(['low', 'medium', 'xhigh'])
    })

    it('模型声明 max 时出现第五档', () => {
        expect(resolveModelEffortLevels({
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        })).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    })

    it('声明里的未知档位名被丢弃', () => {
        expect(resolveModelEffortLevels({ supportedEffortLevels: ['low', 'turbo'] })).toEqual(['low'])
    })

    it('声明缺失或为空时回落四档', () => {
        expect(resolveModelEffortLevels({ supportsEffort: true })).toEqual(EFFORT_LEVELS)
        expect(resolveModelEffortLevels({ supportedEffortLevels: [] })).toEqual(EFFORT_LEVELS)
    })
})

describe('reconcileSessionConfigForModel', () => {
    it('当前档位被目标模型支持时不动', () => {
        expect(reconcileSessionConfigForModel(
            { supportedEffortLevels: ['low', 'medium', 'high'] },
            { effort: 'medium', fastMode: false },
        )).toEqual({})
    })

    it('当前档位越界 → 回落到该模型支持的最高档（max → xhigh）', () => {
        expect(reconcileSessionConfigForModel(
            { supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
            { effort: 'max' },
        )).toEqual({ effort: 'xhigh' })
        expect(reconcileSessionConfigForModel(
            { supportedEffortLevels: ['low', 'medium'] },
            { effort: 'max' },
        )).toEqual({ effort: 'medium' })
    })

    it('模型无能力位（auto / 目录未命中）→ 四档兜底，max 同样回落', () => {
        expect(reconcileSessionConfigForModel(null, { effort: 'max' })).toEqual({ effort: 'xhigh' })
        expect(reconcileSessionConfigForModel(null, { effort: 'high' })).toEqual({})
    })

    it('模型声明不支持 effort → 档位值保持原样（惰性值，换回支持的模型仍生效）', () => {
        expect(reconcileSessionConfigForModel({ supportsEffort: false }, { effort: 'max' })).toEqual({})
    })

    it('模型未声明 supportsFastMode → 已开启的快速模式置 false', () => {
        expect(reconcileSessionConfigForModel({ supportsEffort: true }, { fastMode: true })).toEqual({ fastMode: false })
        expect(reconcileSessionConfigForModel(null, { fastMode: true })).toEqual({ fastMode: false })
    })

    it('模型显式支持快速模式 → 不动', () => {
        expect(reconcileSessionConfigForModel({ supportsFastMode: true }, { fastMode: true })).toEqual({})
    })

    it('本来就是关闭状态 → 不回写 false（不制造无意义的变更）', () => {
        expect(reconcileSessionConfigForModel({}, { fastMode: false })).toEqual({})
        expect(reconcileSessionConfigForModel({}, {})).toEqual({})
    })
})

describe('EFFORT_LABELS', () => {    it('每个级别都有对应的标签', () => {
        for (const level of EFFORT_LEVELS) {
            expect(EFFORT_LABELS[level]).toBeTruthy()
        }
    })

    it('包含预期标签值', () => {
        expect(EFFORT_LABELS.low).toBe('Low')
        expect(EFFORT_LABELS.medium).toBe('Medium')
        expect(EFFORT_LABELS.high).toBe('High')
        expect(EFFORT_LABELS.xhigh).toBe('X-High')
        expect(EFFORT_LABELS.max).toBe('Max')
    })
})

describe('RuntimeStateSchema effort', () => {
    it('有效的 effort 值解析成功', () => {
        for (const level of EFFORT_LEVELS) {
            const result = RuntimeStateSchema.parse({ effort: level })
            expect(result.effort).toBe(level)
        }
    })

    it('effort 为可选字段', () => {
        const result = RuntimeStateSchema.parse({})
        expect(result.effort).toBeUndefined()
    })

    it('effort 为 undefined 时解析成功', () => {
        const result = RuntimeStateSchema.parse({ effort: undefined })
        expect(result.effort).toBeUndefined()
    })

    it('非法 effort 值抛错', () => {
        expect(() => RuntimeStateSchema.parse({ effort: 'invalid' })).toThrow()
        expect(() => RuntimeStateSchema.parse({ effort: '' })).toThrow()
    })

    it('session-only 的 max 在运行时状态里合法', () => {
        const result = RuntimeStateSchema.parse({ effort: 'max' })
        expect(result.effort).toBe('max')
    })

    it('effort 与 model 共存', () => {
        const result = RuntimeStateSchema.parse({ model: 'sonnet', effort: 'high' })
        expect(result.model).toBe('sonnet')
        expect(result.effort).toBe('high')
    })
})

describe('PERMISSION_MODES', () => {
    it('包含全部六个模式，按自由度递增排列（auto 置顶）', () => {
        expect(PERMISSION_MODES).toEqual([
            'auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'
        ])
    })

    it('CLAUDE_PERMISSION_MODES 与 PERMISSION_MODES 一致', () => {
        expect([...CLAUDE_PERMISSION_MODES]).toEqual([...PERMISSION_MODES])
    })

    it('PermissionMode 类型支持全部有效字面量', () => {
        const valid: PermissionMode[] = ['auto', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
        expect(valid).toHaveLength(6)
    })
})

describe('PERMISSION_MODE_LABELS', () => {
    it('每个模式都有非空标签', () => {
        for (const mode of PERMISSION_MODES) {
            expect(PERMISSION_MODE_LABELS[mode]).toBeTruthy()
        }
    })

    it('auto / default(Request Approval) / dontAsk 标签正确', () => {
        expect(PERMISSION_MODE_LABELS.auto).toBe('Auto')
        expect(PERMISSION_MODE_LABELS.default).toBe('Request Approval')
        expect(PERMISSION_MODE_LABELS.dontAsk).toBe("Don't Ask")
    })
})

describe('PERMISSION_MODE_TONES', () => {
    it('每个模式都有合法 tone', () => {
        const validTones: PermissionModeTone[] = ['neutral', 'gold', 'purple', 'green', 'danger']
        for (const mode of PERMISSION_MODES) {
            expect(validTones).toContain(PERMISSION_MODE_TONES[mode])
        }
    })

    it('auto = gold（金黄，对齐 Claude CLI）', () => {
        expect(PERMISSION_MODE_TONES.auto).toBe('gold')
    })

    it('default = neutral（灰）', () => {
        expect(PERMISSION_MODE_TONES.default).toBe('neutral')
    })

    it('acceptEdits = purple（紫）', () => {
        expect(PERMISSION_MODE_TONES.acceptEdits).toBe('purple')
    })

    it('plan = green（绿）', () => {
        expect(PERMISSION_MODE_TONES.plan).toBe('green')
    })

    it('bypassPermissions / dontAsk = danger（红）', () => {
        expect(PERMISSION_MODE_TONES.bypassPermissions).toBe('danger')
        expect(PERMISSION_MODE_TONES.dontAsk).toBe('danger')
    })
})
