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
 * resolveFileType 纯函数契约：文件/目录判定 + 扩展名徽章元数据。
 * 判定规则见 fileTypeMeta.ts 头注释（目录=basename 无 `.`；dotfile 是文件）。
 */

import { describe, it, expect } from 'vitest'
import { resolveFileType } from '@/core/lib/fileTypeMeta'

describe('resolveFileType', () => {
    it('已知扩展名：返回表内缩写与配色', () => {
        expect(resolveFileType('src/App.tsx')).toEqual({ kind: 'file', label: 'TSX', color: '#3178C6' })
        expect(resolveFileType('README.md')).toEqual({ kind: 'file', label: 'MD', color: '#4A7CA5' })
        expect(resolveFileType('package.json')).toEqual({ kind: 'file', label: '{ }', color: '#B08800' })
    })

    it('未知扩展名：中性色 + 大写截 4 字符', () => {
        expect(resolveFileType('a/b/data.csv')).toEqual({ kind: 'file', label: 'CSV', color: '#7A7A7A' })
        expect(resolveFileType('photo.abcdefg')).toEqual({ kind: 'file', label: 'ABCD', color: '#7A7A7A' })
    })

    it('扩展名大小写不敏感（A.TS 与 a.ts 同判）', () => {
        expect(resolveFileType('a.TS')).toEqual(resolveFileType('a.ts'))
    })

    it('basename 无 `.` → 目录（含尾部斜杠）', () => {
        expect(resolveFileType('src/components')).toEqual({ kind: 'directory' })
        expect(resolveFileType('src/components/')).toEqual({ kind: 'directory' })
    })

    it('隐藏 dotfile 是文件而非目录：.env 无扩展名 → 通用 glyph（label null）', () => {
        expect(resolveFileType('.env')).toEqual({ kind: 'file', label: null, color: '#7A7A7A' })
        expect(resolveFileType('.gitignore')).toEqual({ kind: 'file', label: null, color: '#7A7A7A' })
    })

    it('无扩展名的惯例文件名（Dockerfile/Makefile）判为文件而非目录（KNOWN_EXTENSIONLESS_FILES 单源）', () => {
        expect(resolveFileType('Dockerfile')).toEqual({ kind: 'file', label: null, color: '#7A7A7A' })
        expect(resolveFileType('scripts/Makefile').kind).toBe('file')
        expect(resolveFileType('x/Makefile').kind).toBe('file')
    })

    it('多点文件取最后一个 `.`（app.test.ts → TS）', () => {
        expect(resolveFileType('app.test.ts')).toEqual({ kind: 'file', label: 'TS', color: '#3178C6' })
    })

    it('空路径 / 纯斜杠：返回 null（展示层不画徽章）', () => {
        expect(resolveFileType('')).toBeNull()
        expect(resolveFileType('///')).toBeNull()
    })
})
