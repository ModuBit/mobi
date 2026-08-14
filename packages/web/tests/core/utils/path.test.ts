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
 * isPathWithinHomeDir 回归守卫：与 hub validateHomeDirPath 同向
 * （斜杠归一 + 大小写不敏感），宁可放行交 hub 400 兜底，不可误杀表单
 */

import { describe, it, expect } from 'vitest'
import { isPathWithinHomeDir } from '@/core/utils/path'

describe('isPathWithinHomeDir', () => {
    it('posix：home 内（含本身、尾斜杠）放行，home 外拒绝', () => {
        expect(isPathWithinHomeDir('/home/u/proj', '/home/u')).toBe(true)
        expect(isPathWithinHomeDir('/home/u', '/home/u')).toBe(true)
        expect(isPathWithinHomeDir('/home/u/', '/home/u')).toBe(true)
        expect(isPathWithinHomeDir('/etc/secret', '/home/u')).toBe(false)
    })

    it('win32 反斜杠路径不误杀（hub 权威判定放行，表单必须同向）', () => {
        expect(isPathWithinHomeDir('C:\\Users\\me\\proj', 'C:\\Users\\me')).toBe(true)
        expect(isPathWithinHomeDir('C:\\Users\\me', 'C:\\Users\\me')).toBe(true)
        expect(isPathWithinHomeDir('D:\\other\\proj', 'C:\\Users\\me')).toBe(false)
    })

    it('大小写不敏感（homeDir 与路径大小写笔误不误杀，交 hub 权威裁决）', () => {
        expect(isPathWithinHomeDir('/Users/Foo/proj', '/users/foo')).toBe(true)
        expect(isPathWithinHomeDir('c:\\users\\me\\proj', 'C:\\Users\\me')).toBe(true)
    })

    it('前缀段不误判：/home/username 不是 /home/user 的子路径', () => {
        expect(isPathWithinHomeDir('/home/username', '/home/user')).toBe(false)
    })

    it('空值拒绝', () => {
        expect(isPathWithinHomeDir('', '/home/u')).toBe(false)
        expect(isPathWithinHomeDir('/x', '')).toBe(false)
    })
})
