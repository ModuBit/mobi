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
import {
    ACTION_REGISTRY,
    MOBI_URI_SCHEME,
    buildActionUri,
    parseActionUri,
    refBlockToActionText,
} from '../src/actionUri'

describe('parseActionUri：已注册动作', () => {
    it('session/open 标准形态解析为强类型产物', () => {
        const parsed = parseActionUri('mobi://session/open?id=s-1')
        expect(parsed).toMatchObject({ key: 'session/open', domain: 'session', action: 'open', params: { id: 's-1' }, risk: 'navigate' })
    })

    it('scheme 大小写不敏感（URI 惯例归一）', () => {
        expect(parseActionUri('MOBI://session/open?id=s-1')?.key).toBe('session/open')
        expect(parseActionUri('Mobi://session/open?id=s-1')).not.toBeNull()
    })

    it('多参数与值编码（buildActionUri 往返）', () => {
        const uri = buildActionUri('session/open', { id: 'a b/中文' })
        expect(uri).toBe('mobi://session/open?id=a+b%2F%E4%B8%AD%E6%96%87')
        expect(parseActionUri(uri)).toMatchObject({ params: { id: 'a b/中文' } })
    })
})

describe('parseActionUri：未注册与畸形', () => {
    it('未注册 domain/action 返回可判别的 { key: null }（web toast 文案区分）', () => {
        expect(parseActionUri('mobi://file/download?path=/tmp')).toEqual({ key: null, domain: 'file', action: 'download' })
        expect(parseActionUri('mobi://session/close?id=s-1')).toEqual({ key: null, domain: 'session', action: 'close' })
    })

    it('畸形矩阵 → null：坏 scheme / path 多段 / path 空 / 尾斜杠 / 端口 / userinfo / 非法字符 / 非 URL', () => {
        expect(parseActionUri('https://session/open?id=x')).toBeNull()
        expect(parseActionUri('mobi://session/open/extra?id=x')).toBeNull()
        expect(parseActionUri('mobi://session')).toBeNull()
        expect(parseActionUri('mobi://session/open?id=')).toBeNull()      // 已注册但 id 空参数校验失败
        expect(parseActionUri('mobi://session/open/')).toBeNull()          // 尾斜杠（路径归一化放行=仿冒面）
        expect(parseActionUri('mobi://session:6379/open?id=x')).toBeNull() // 端口被 hostname 静默剥离，须拒绝
        expect(parseActionUri('mobi://a@session/open?id=x')).toBeNull()    // userinfo 同上
        expect(parseActionUri('mobi://se ssion/open?id=x')).toBeNull()
        expect(parseActionUri('not a url')).toBeNull()
        expect(parseActionUri('')).toBeNull()
    })
})

describe('ACTION_REGISTRY 与 buildActionUri：注册表契约', () => {
    it('注册 session/open 与 file/open，均 risk=navigate（send 枚举供 message/send）', () => {
        expect(Object.keys(ACTION_REGISTRY)).toEqual(['session/open', 'file/open'])
        expect(ACTION_REGISTRY['session/open'].risk).toBe('navigate')
        expect(ACTION_REGISTRY['file/open'].risk).toBe('navigate')
    })

    it('buildActionUri 拒绝未注册键（写入侧不允许产出未注册动作）', () => {
        // @ts-expect-error 未注册键类型层即拒绝
        expect(() => buildActionUri('message/send', { text: 'hi' })).toThrow()
    })

    it('scheme 常量', () => {
        expect(MOBI_URI_SCHEME).toBe('mobi')
    })
})

describe('file/open：解析与构造（ADR 0003 二期）', () => {
    it('最小参数（相对路径）解析：expand 缺省 true，name 缺省 undefined', () => {
        const parsed = parseActionUri('mobi://file/open?path=.mobi%2Fuploads%2Fa.pdf')
        expect(parsed).toMatchObject({ key: 'file/open', params: { path: '.mobi/uploads/a.pdf', expand: true } })
        expect((parsed as { params: { name?: string } }).params.name).toBeUndefined()
    })

    it('绝对路径 + name + expand=false：枚举字面量 transform 成 boolean', () => {
        const uri = buildActionUri('file/open', { path: '/tmp/demo/x.md', name: 'x.md', expand: false })
        const parsed = parseActionUri(uri)
        expect(parsed).toMatchObject({
            key: 'file/open',
            params: { path: '/tmp/demo/x.md', name: 'x.md', expand: false },
        })
    })

    it('buildActionUri 剔除 undefined 可选参数（不落 undefined 字面量）', () => {
        const uri = buildActionUri('file/open', { path: 'a.md', name: undefined, expand: undefined })
        expect(uri).toBe('mobi://file/open?path=a.md')
    })

    it('path 缺失 → 畸形 null（统一降级文案）', () => {
        expect(parseActionUri('mobi://file/open?name=a.md')).toBeNull()
    })
})

describe('refBlockToActionText：存量 ref 迁移（ADR 0003）', () => {
    it('session ref → 冻结文案的 md 动作链接', () => {
        expect(refBlockToActionText({ targetType: 'session', id: 's-1' }, '我的项目'))
            .toBe('[我的项目](mobi://session/open?id=s-1)')
    })

    it('未注册 targetType → null（保守不改写）', () => {
        expect(refBlockToActionText({ targetType: 'unknown-kind', id: 'x' }, 't')).toBeNull()
    })
})
