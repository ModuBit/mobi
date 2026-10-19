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

/** 地图设置三档推导与锁内合并写（Map 票 01/02 共用契约） */

import { describe, it, expect } from 'vitest'
import {
    deriveMapMode,
    mergeMapSettings,
    toMapSettingsView,
    MapSettingsSchema,
    MapSettingsSubmissionSchema,
} from '../src/mapSettings'

describe('deriveMapMode', () => {
    it('未配置 → none', () => {
        expect(deriveMapMode(undefined)).toBe('none')
        expect(deriveMapMode({})).toBe('none')
        expect(deriveMapMode({ jsApiKey: ' ', webServiceKey: ' ' })).toBe('none')
    })

    it('JS API key + 安全密钥齐备 → interactive', () => {
        expect(deriveMapMode({ jsApiKey: 'k', securityJsCode: 's' })).toBe('interactive')
    })

    it('只有 JS API key（缺安全密钥）→ 退到 static/none', () => {
        expect(deriveMapMode({ jsApiKey: 'k' })).toBe('none')
        expect(deriveMapMode({ jsApiKey: 'k', webServiceKey: 'w' })).toBe('static')
    })

    it('只有 Web 服务 key → static', () => {
        expect(deriveMapMode({ webServiceKey: 'w' })).toBe('static')
    })
})

describe('toMapSettingsView', () => {
    it('Web 服务 key 只回在场标记，不回明文', () => {
        const view = toMapSettingsView({ jsApiKey: 'k', securityJsCode: 's', webServiceKey: 'w' })
        expect(view).toEqual({ mode: 'interactive', jsApiKey: 'k', securityJsCode: 's', webServiceKeySet: true })
        expect(JSON.stringify(view)).not.toContain('"w"')
    })

    it('空白字段回 undefined', () => {
        expect(toMapSettingsView({ jsApiKey: '  ' })).toEqual({
            mode: 'none',
            jsApiKey: undefined,
            securityJsCode: undefined,
            webServiceKeySet: false,
        })
    })
})

describe('mergeMapSettings', () => {
    it('非空覆盖、空白清除、不在场保持', () => {
        const next = mergeMapSettings(
            { jsApiKey: 'old', securityJsCode: 'keep', webServiceKey: 'w' },
            { jsApiKey: ' new ', webServiceKey: '' },
        )
        expect(next).toEqual({ jsApiKey: 'new', securityJsCode: 'keep' })
    })

    it('提交空对象保持原值', () => {
        expect(mergeMapSettings({ jsApiKey: 'k' }, {})).toEqual({ jsApiKey: 'k' })
    })
})

describe('Schema', () => {
    it('存储方向 trim', () => {
        expect(MapSettingsSchema.parse({ jsApiKey: ' k ' })).toEqual({ jsApiKey: 'k' })
    })

    it('提交方向保留空串（空串语义是清除，不能被 schema 抹掉）', () => {
        expect(MapSettingsSubmissionSchema.parse({ jsApiKey: '' })).toEqual({ jsApiKey: '' })
    })
})
