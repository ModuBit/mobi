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
 * FileRefContext 投影测试：所有消费方（画板回源/气泡图/附件缩略图）的字段
 * 挑选只在这一处定义（见 fileUrl 模块文档）。
 */

import { describe, expect, it } from 'vitest'
import { fileRefContext } from '@/core/utils/fileUrl'

describe('fileRefContext 字段投影', () => {
    it('元数据的 path 映射为 cwd，machineId 原样透传', () => {
        expect(fileRefContext('s-1', { machineId: 'm-1', path: '/home/u/proj' })).toEqual({
            sessionId: 's-1',
            machineId: 'm-1',
            cwd: '/home/u/proj',
        })
    })

    it('元数据缺省（新建会话等）时 machine/cwd 为 undefined，仅留 session 回退通道', () => {
        expect(fileRefContext('s-1', null)).toEqual({ sessionId: 's-1', machineId: undefined, cwd: undefined })
        expect(fileRefContext('s-1', undefined)).toEqual({ sessionId: 's-1', machineId: undefined, cwd: undefined })
    })

    it('sessionId 缺省（恢复态老入口）时不阻塞 machine 寻址', () => {
        expect(fileRefContext(undefined, { machineId: 'm-1', path: '/w' })).toEqual({
            sessionId: undefined,
            machineId: 'm-1',
            cwd: '/w',
        })
    })
})
