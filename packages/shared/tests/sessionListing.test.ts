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
 * 会话显示标题单源取值链（resolveSessionTitle）：daemon 只读投影与 Web 展示共用，
 * 优先级反转（fork 行 name 优先）只允许在这一处拼写。
 */

import { describe, expect, it } from 'vitest'
import { FORKABLE_STATUSES, resolveSessionTitle } from '../src/sessionListing'

describe('resolveSessionTitle', () => {
    it('非 fork 行：summary.text 优先于 name（与 Web 展示一致）', () => {
        expect(resolveSessionTitle({ name: '命名', summaryText: '动态摘要', path: '/w/demo', isFork: false }))
            .toBe('动态摘要')
    })

    it('非 fork 行无 summary：回落 name，再回落 path 基名', () => {
        expect(resolveSessionTitle({ name: '命名', summaryText: null, path: '/w/demo', isFork: false }))
            .toBe('命名')
        expect(resolveSessionTitle({ name: null, summaryText: null, path: '/w/demo', isFork: false }))
            .toBe('demo')
    })

    it('fork 行反转：name 优先，summary 不盖「· 分叉」身份标题', () => {
        expect(resolveSessionTitle({ name: '父会话 · 分叉', summaryText: 'fork 自身摘要', path: '/w/demo', isFork: true }))
            .toBe('父会话 · 分叉')
    })

    it('fork 行无 name：回落 path 基名；全空返回 null（消费方各自兜底）', () => {
        expect(resolveSessionTitle({ name: null, summaryText: '摘要', path: '/w/demo', isFork: true }))
            .toBe('demo')
        expect(resolveSessionTitle({ name: null, summaryText: null, path: null, isFork: true }))
            .toBeNull()
    })

    it('空字符串与 null 同待遇（写侧脏值的防御）', () => {
        expect(resolveSessionTitle({ name: '', summaryText: '', path: '/w/demo', isFork: false }))
            .toBe('demo')
    })

    it('FORKABLE_STATUSES 单源：SQL 过滤与类型 Extract 共用同一状态集', () => {
        expect(FORKABLE_STATUSES).toEqual(['online', 'dormant'])
    })
})
