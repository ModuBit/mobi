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

import { describe, expect, it } from 'vitest'
import { lookupMime } from '@/modules/common/handlers/fileMime'

describe('lookupMime', () => {
    it('常见扩展名命中 mime 表', () => {
        expect(lookupMime('a.ts')).toBe('text/typescript')
        expect(lookupMime('a.py')).toBe('text/x-python')
        expect(lookupMime('a.json')).toBe('application/json')
        expect(lookupMime('a.pdf')).toBe('application/pdf')
        expect(lookupMime('a.png')).toBe('image/png')
    })

    it('扩展名大小写不敏感', () => {
        expect(lookupMime('A.TS')).toBe('text/typescript')
        expect(lookupMime('Readme.MD')).toBe('text/markdown')
    })

    it('无扩展名（纯文件名）返回 octet-stream，而非用整个文件名误匹配', () => {
        // 无 "." 时 lastIndexOf 返回 -1，slice(0) 会取整个文件名；
        // 纯文件名（如 README、Makefile）不应当作扩展名查表
        expect(lookupMime('README')).toBe('application/octet-stream')
        expect(lookupMime('Makefile')).toBe('application/octet-stream')
        // 关键：若纯文件名恰为已知 mime key（如 "json" 无 "."），旧逻辑会用整个串误匹配为 application/json
        expect(lookupMime('json')).toBe('application/octet-stream')
        expect(lookupMime('pdf')).toBe('application/octet-stream')
    })

    it('点结尾的文件名（隐藏文件 ".gitignore" 除外）无主体扩展名时返回 octet-stream', () => {
        // "foo." → lastIndexOf=3, slice(4)="" 空串未命中 → octet-stream
        expect(lookupMime('foo.')).toBe('application/octet-stream')
    })

    it('未命中扩展名返回 octet-stream', () => {
        expect(lookupMime('a.unknownext')).toBe('application/octet-stream')
    })

    it('扩展名在常见源码表中（Fix 6 扩表）命中 text/* 以便 web 预览', () => {
        // 选 text/* 让 web FileContentView isTextLike 命中预览
        expect(lookupMime('a.vue')).toBe('text/x-vue')
        expect(lookupMime('a.svelte')).toBe('text/x-svelte')
        expect(lookupMime('a.dart')).toBe('text/x-dart')
        expect(lookupMime('a.lua')).toBe('text/x-lua')
        expect(lookupMime('a.r')).toBe('text/x-r')
        expect(lookupMime('a.scala')).toBe('text/x-scala')
        expect(lookupMime('a.clj')).toBe('text/x-clojure')
        expect(lookupMime('a.hs')).toBe('text/x-haskell')
        expect(lookupMime('a.proto')).toBe('text/x-protobuf')
        expect(lookupMime('a.tf')).toBe('text/x-hcl')
    })

    it('路径式文件名按最后一段扩展名判定', () => {
        expect(lookupMime('path/to/file.ts')).toBe('text/typescript')
    })

    it('字体类扩展名命中 font/* （HTML 预览的 web font/字体图标依赖）', () => {
        expect(lookupMime('a.woff2')).toBe('font/woff2')
        expect(lookupMime('a.woff')).toBe('font/woff')
        expect(lookupMime('a.ttf')).toBe('font/ttf')
        expect(lookupMime('a.otf')).toBe('font/otf')
        expect(lookupMime('a.eot')).toBe('application/vnd.ms-fontobject')
    })
})
