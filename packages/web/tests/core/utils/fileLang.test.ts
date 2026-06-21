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
import { resolveFileLang } from '@/core/utils/fileLang'

describe('resolveFileLang', () => {
    it('常见扩展名映射到 Shiki canonical 语言', () => {
        expect(resolveFileLang('a/b/c.ts')).toBe('typescript')
        expect(resolveFileLang('script.sh')).toBe('shellscript')
        expect(resolveFileLang('config.yml')).toBe('yaml')
        expect(resolveFileLang('README.md')).toBe('markdown')
        expect(resolveFileLang('app.py')).toBe('python')
        expect(resolveFileLang('index.jsx')).toBe('jsx')
        expect(resolveFileLang('App.tsx')).toBe('tsx')
        expect(resolveFileLang('package.json')).toBe('json')
        expect(resolveFileLang('Dockerfile.dev')).toBe('dockerfile')
    })

    it('Dockerfile 无扩展名特殊处理', () => {
        expect(resolveFileLang('Dockerfile')).toBe('dockerfile')
        expect(resolveFileLang('Dockerfile.dev')).toBe('dockerfile')
        expect(resolveFileLang('apps/api/Dockerfile')).toBe('dockerfile')
    })

    it('未知扩展名 / 无扩展名 / dotfile → text', () => {
        expect(resolveFileLang('weird.xyz')).toBe('text')
        expect(resolveFileLang('README')).toBe('text')
        expect(resolveFileLang('.bashrc')).toBe('text')
        expect(resolveFileLang('.env')).toBe('text')
    })

    it('别名与大小写归一', () => {
        // 别名
        expect(resolveFileLang('run.bash')).toBe('shellscript')
        expect(resolveFileLang('app.mjs')).toBe('javascript')
        expect(resolveFileLang('types.mts')).toBe('typescript')
        expect(resolveFileLang('change.patch')).toBe('diff')
        // 大小写归一
        expect(resolveFileLang('App.TSX')).toBe('tsx')
        expect(resolveFileLang('Script.SH')).toBe('shellscript')
    })
})
