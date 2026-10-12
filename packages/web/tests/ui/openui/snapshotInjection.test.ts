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
 * 快照回注解析规格（状态持久化票 02，legacy 通道随 63aacaa5 裁决删除）：
 * - 键集 = react-lang getFormPayload 的返回形状（$ 标识符键，E2E 实锤）
 * - 对象值 = 命名表单容器原样回注（forms 提供时校验归属）；标量值 = 直接绑定
 *   字段原样回注；值 ∈ phase 值域的机制键剔除；非 $ 键忽略
 */

import { describe, it, expect } from 'vitest'
import { resolveFormSnapshotInjection, resolveMergedSnapshotInjection } from '@/ui/openui/snapshotInjection'

describe('resolveFormSnapshotInjection（快照回注映射）', () => {
    it('命名表单：$ 键对象值原样回注（E2E 实锤真实形状 { "$todos": {...} }）', () => {
        const formState = { '$todos': { task1: true, task2: true, task3: false } }
        expect(resolveFormSnapshotInjection(formState)).toEqual({ $todos: { task1: true, task2: true, task3: false } })
    })

    it('多表单：快照键 ∈ forms 映射 → 原样回注（票 03）', () => {
        const forms = new Map([['panel-a', ['$todosA']], ['panel-b', ['$todosB']]])
        expect(resolveFormSnapshotInjection({ '$todosB': { b: true } }, forms)).toEqual({ $todosB: { b: true } })
        expect(resolveFormSnapshotInjection({ '$todosA': { a: true } }, forms)).toEqual({ $todosA: { a: true } })
    })

    it('多表单：快照键不在 forms 映射（伪造/无关键）→ null 静默降级（票 03）', () => {
        const forms = new Map([['panel-a', ['$todosA']], ['panel-b', ['$todosB']]])
        expect(resolveFormSnapshotInjection({ '$evil': { x: 1 } }, forms)).toBeNull()
    })

    it('forms 未提供（解析失败降级）→ 键为 $ 标识符仍原样回注（快照源自家持久化，信任）', () => {
        expect(resolveFormSnapshotInjection({ '$todosB': { b: true } })).toEqual({ $todosB: { b: true } })
    })

    it('标量表单：全 $ 标量包（字段直接绑定 $ 变量，E2E 实锤模型重写反馈面板的形状）按键原样回注', () => {
        // 模型把表单字段直接绑定到 $feedback = "" 这类标量变量而非 $answers = {} 容器，
        // 快照即 { "$feedback": "内容", ... }——旧逻辑对全标量 $ 键返回 null，刷新后内容丢失
        const formState = { '$actionState': 'idle', '$feedback': '写得很清楚' }
        expect(resolveFormSnapshotInjection(formState)).toEqual({ $feedback: '写得很清楚' })
    })

    it('标量表单：值 ∈ phase 值域的 $ 键是状态机制变量瞬态，剔除防覆盖派生 phase', () => {
        // 若 $actionState:"idle" 被回注，renderer 的 initialState 会以 idle 覆盖派生
        // 的 done——按钮解锁定，一次性操作复开
        const formState = { '$actionState': 'running', '$feedback': '内容' }
        expect(resolveFormSnapshotInjection(formState)).toEqual({ $feedback: '内容' })
    })

    it('全是机制键（无可恢复数据）→ null', () => {
        expect(resolveFormSnapshotInjection({ '$actionState': 'running' })).toBeNull()
    })

    it('非 $ 键不是 react-lang 的产出，忽略（legacy 容器定位通道已删除）', () => {
        expect(resolveFormSnapshotInjection({ 'todo-panel': { task1: true }, '$contact': '张三' })).toEqual({ $contact: '张三' })
        expect(resolveFormSnapshotInjection({ 'todo-panel': { task1: true } })).toBeNull()
    })

    it('无 $ 键（空快照）→ null', () => {
        expect(resolveFormSnapshotInjection({})).toBeNull()
    })

    it('混合包：容器对象 + 直接绑定标量字段共存（E2E 实锤 $subscribe + $contact），各自回注', () => {
        // 旧「唯一对象值键」分支只回注容器、丢弃标量字段——刷新后勾选恢复、文本留不下
        const formState = { '$formAState': 'idle', '$contact': '复验值A', '$subscribe': { news: true } }
        expect(resolveFormSnapshotInjection(formState)).toEqual({
            $contact: '复验值A',
            $subscribe: { news: true },
        })
    })
})

describe('resolveMergedSnapshotInjection（per-action 多快照合并回注）', () => {
    it('两个表单容器快照逐条解析后合并（E2E 实锤：先合并再解析会破坏归属校验整体降级）', () => {
        const merged = resolveMergedSnapshotInjection(
            [{ '$todosA': { a: true } }, { '$todosB': { b: false } }],
        )
        expect(merged).toEqual({ $todosA: { a: true }, $todosB: { b: false } })
    })

    it('对象容器与标量包合并（各操作表单形状不同）', () => {
        const merged = resolveMergedSnapshotInjection(
            [{ '$todosA': { a: true } }, { '$actionState': 'idle', '$note': '备注' }],
        )
        expect(merged).toEqual({ $todosA: { a: true }, $note: '备注' })
    })

    it('全部无法解析（空/降级）→ null', () => {
        expect(resolveMergedSnapshotInjection([undefined, { '$actionState': 'running' }])).toBeNull()
        expect(resolveMergedSnapshotInjection([])).toBeNull()
    })
})
