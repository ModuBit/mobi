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
import { SESSION_CONFIG_FIELDS } from '../src/sessionConfig'

/**
 * 会话配置字段注册表（深化候选②）：四端（hub 路由 / hub sessionCache / cli handler /
 * cli syncSessionModes）接线的单一声明源。这里锁定声明契约——字段集合、生效语义、
 * 校验 schema、对外 body 字段名（路由兼容层，改动即 web 端 breaking）。
 */
describe('SESSION_CONFIG_FIELDS', () => {
    it('字段集合：三个 live 字段 + outputStyle（restart 语义）', () => {
        expect(Object.keys(SESSION_CONFIG_FIELDS)).toEqual([
            'permissionMode', 'model', 'effort', 'outputStyle',
        ])
        expect(SESSION_CONFIG_FIELDS.permissionMode.apply).toBe('live')
        expect(SESSION_CONFIG_FIELDS.model.apply).toBe('live')
        expect(SESSION_CONFIG_FIELDS.effort.apply).toBe('live')
        // output style 切换是 /clear 语义（哨兵退轮重启生效），与 live 字段机制本质不同
        expect(SESSION_CONFIG_FIELDS.outputStyle.apply).toBe('restart')
    })

    it('bodyKey 是对外 REST body 字段名（web API 兼容契约）', () => {
        expect(SESSION_CONFIG_FIELDS.permissionMode.bodyKey).toBe('mode')
        expect(SESSION_CONFIG_FIELDS.model.bodyKey).toBe('model')
        expect(SESSION_CONFIG_FIELDS.effort.bodyKey).toBe('effort')
        expect(SESSION_CONFIG_FIELDS.outputStyle.bodyKey).toBe('style')
    })

    it.each([
        ['permissionMode', 'plan', true],
        ['permissionMode', 'yolo', false],        // 大小写敏感，非合法枚举
        ['model', null, true],
        ['model', 'claude-opus-4-8', true],
        ['model', 123, false],
        ['effort', 'xhigh', true],
        ['effort', 'max', false],                 // EFFORT_LEVELS 不含 max（启动/运行时口径一致）
        ['outputStyle', 'Explanatory', true],
        ['outputStyle', '', false],               // 只挡空串：自定义 style 合法性由 CLI 守卫
    ])('%s 接受 %j → %j', (field, value, ok) => {
        const schema = SESSION_CONFIG_FIELDS[field as keyof typeof SESSION_CONFIG_FIELDS].schema
        expect(schema.safeParse(value).success).toBe(ok)
    })
})
