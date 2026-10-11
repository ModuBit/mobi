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
 * 快照回注解析规格（状态持久化票 02）：
 * - resolveStateActionVars：从 fence 源码识别「默认值 ∈ phase 值域」的状态 $ 变量
 *   （值域约定——模型自创名如 $mdState 同样命中，$actionState 只是惯用特例）
 * - resolveFormSnapshotInjection：formState → 要并入 initialState 的 $ 键映射。
 *   命名表单取内层字段集，注入目标 = 源码中唯一的空对象声明 $ 变量；0/多个 → null（静默降级）
 */

import { describe, it, expect } from 'vitest'
import { resolveStateActionVars, resolveFormSnapshotInjection, resolveMergedSnapshotInjection } from '@/components/ui/openui/snapshotInjection'

describe('resolveStateActionVars（值域识别状态变量）', () => {
    it('惯用名 $actionState 命中', () => {
        const code = '$actionState = "idle"\nbtn = Button(btnLabel, Action([@ToAssistant("go")]))'
        expect(resolveStateActionVars(code)).toEqual(['$actionState'])
    })

    it('模型自创名（$mdState/$jsonState）同样命中', () => {
        const code = '$mdState = "idle"\n$jsonState = "idle"\nroot = Stack([a, b])'
        expect(resolveStateActionVars(code)).toEqual(['$mdState', '$jsonState'])
    })

    it('默认值不在值域的 $ 变量不命中', () => {
        const code = '$todos = {}\n$name = "张三"\n$actionState = "idle"'
        expect(resolveStateActionVars(code)).toEqual(['$actionState'])
    })

    it('无声明 → 空数组', () => {
        expect(resolveStateActionVars('root = Card([])')).toEqual([])
    })
})

describe('resolveFormSnapshotInjection（快照回注映射）', () => {
    const code = [
        'root = Card([header, todoForm])',
        'todoForm = Form("todo-panel", submitButtons, [todoField])',
        'checks = CheckBoxGroup("todos", [item1, item2], null, $todos)',
        '$todos = {}',
    ].join('\n')

    it('命名表单：内层字段集注入唯一空对象 $ 变量', () => {
        const formState = { 'todo-panel': { task1: true, task2: false } }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $todos: { task1: true, task2: false } })
    })

    it('命名表单键本身是 $ 变量（E2E 实锤真实形状 { "$todos": {...} }）——不被 $ 剥离误伤', () => {
        // react-lang getFormPayload 返回 { [formName]: raw }，formName 就是绑定变量名（$ 前缀）
        const formState = { '$todos': { task1: true, task2: true, task3: false } }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $todos: { task1: true, task2: true, task3: false } })
    })

    it('多表单：快照键 ∈ forms 映射 → 原样回注（票 03：不要求源码唯一空对象声明）', () => {
        const multiForm = [
            'root = Card([formA, formB])',
            'formA = Form("panel-a", buttonsA, [fieldA])',
            'checksA = CheckBoxGroup("todos-a", [a], null, $todosA)',
            'formB = Form("panel-b", buttonsB, [fieldB])',
            'checksB = CheckBoxGroup("todos-b", [b], null, $todosB)',
            '$todosA = {}',
            '$todosB = {}',
        ].join('\n')
        const forms = new Map([['panel-a', ['$todosA']], ['panel-b', ['$todosB']]])
        expect(resolveFormSnapshotInjection(multiForm, { '$todosB': { b: true } }, forms)).toEqual({ $todosB: { b: true } })
        expect(resolveFormSnapshotInjection(multiForm, { '$todosA': { a: true } }, forms)).toEqual({ $todosA: { a: true } })
    })

    it('多表单：快照键不在 forms 映射（伪造/无关键）→ null 静默降级（票 03）', () => {
        const multiForm = [
            'root = Card([formA, formB])',
            'formA = Form("panel-a", buttonsA, [fieldA])',
            'checksA = CheckBoxGroup("todos-a", [a], null, $todosA)',
            'formB = Form("panel-b", buttonsB, [fieldB])',
            'checksB = CheckBoxGroup("todos-b", [b], null, $todosB)',
            '$todosA = {}',
            '$todosB = {}',
        ].join('\n')
        const forms = new Map([['panel-a', ['$todosA']], ['panel-b', ['$todosB']]])
        expect(resolveFormSnapshotInjection(multiForm, { '$evil': { x: 1 } }, forms)).toBeNull()
    })

    it('多表单：forms 未提供（解析失败降级）→ 键为 $ 标识符仍原样回注（快照源自家持久化，信任）', () => {
        const multiForm = [
            'root = Card([formA, formB])',
            'formA = Form("panel-a", buttonsA, [fieldA])',
            'checksA = CheckBoxGroup("todos-a", [a], null, $todosA)',
            'formB = Form("panel-b", buttonsB, [fieldB])',
            'checksB = CheckBoxGroup("todos-b", [b], null, $todosB)',
            '$todosA = {}',
            '$todosB = {}',
        ].join('\n')
        // 无 forms 表时键是 $ 标识符即信任回注——比旧「唯一空对象声明」约束恢复面更广
        expect(resolveFormSnapshotInjection(multiForm, { '$todosB': { b: true } })).toEqual({ $todosB: { b: true } })
    })

    it('多个空对象声明变量无法唯一定位 → null（静默降级）', () => {
        const multi = code + '\n$other = {}'
        const formState = { 'todo-panel': { task1: true } }
        expect(resolveFormSnapshotInjection(multi, formState)).toBeNull()
    })

    it('源码无空对象声明 → null', () => {
        const noVar = 'root = Card([])'
        expect(resolveFormSnapshotInjection(noVar, { 'f': { a: 1 } })).toBeNull()
    })

    it('快照 $ 键不回注（机制变量不是表单数据）', () => {
        // 顶层混入 $ 机制键时剥离后再走命名/无名分支
        const formState = { '$actionState': 'done', 'todo-panel': { task1: true } }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $todos: { task1: true } })
    })

    it('无名表单（顶层即字段集）同样注入唯一空对象变量', () => {
        const formState = { task1: true, task2: false }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $todos: { task1: true, task2: false } })
    })

    it('标量表单：全 $ 标量包（字段直接绑定 $ 变量，E2E 实锤模型重写反馈面板的形状）按键原样回注', () => {
        // 模型把表单字段直接绑定到 $feedback = "" 这类标量变量而非 $answers = {} 容器，
        // 快照即 { "$feedback": "内容", ... }——旧逻辑对全标量 $ 键返回 null，刷新后内容丢失
        const formState = { '$actionState': 'idle', '$feedback': '写得很清楚' }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $feedback: '写得很清楚' })
    })

    it('标量表单：值 ∈ phase 值域的 $ 键是状态机制变量瞬态，剔除防覆盖派生 phase', () => {
        // 若 $actionState:"idle" 被回注，renderer 的 initialState 会以 idle 覆盖派生
        // 的 done——按钮解锁定，一次性操作复开
        const formState = { '$actionState': 'running', '$feedback': '内容' }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({ $feedback: '内容' })
    })

    it('标量表单：全是机制键（无可恢复数据）→ null', () => {
        expect(resolveFormSnapshotInjection(code, { '$actionState': 'running' })).toBeNull()
    })

    it('混合包：容器对象 + 直接绑定标量字段共存（E2E 实锤 $subscribe + $contact），各自回注', () => {
        // 旧「唯一对象值键」分支只回注容器、丢弃标量字段——刷新后勾选恢复、文本留不下
        const formState = { '$formAState': 'idle', '$contact': '复验值A', '$subscribe': { news: true } }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({
            $contact: '复验值A',
            $subscribe: { news: true },
        })
    })

    it('混合包：非 $ 键字段与 $ 标量共存——非 $ 走容器定位，$ 标量直接回注', () => {
        const formState = { 'todo-panel': { task1: true }, '$contact': '张三' }
        expect(resolveFormSnapshotInjection(code, formState)).toEqual({
            $contact: '张三',
            $todos: { task1: true },
        })
    })
})

describe('resolveMergedSnapshotInjection（per-action 多快照合并回注）', () => {
    const multiForm = [
        'root = Card([formA, formB])',
        'formA = Form("panel-a", buttonsA, [fieldA])',
        'checksA = CheckBoxGroup("todos-a", [a], null, $todosA)',
        'formB = Form("panel-b", buttonsB, [fieldB])',
        'checksB = CheckBoxGroup("todos-b", [b], null, $todosB)',
        '$todosA = {}',
        '$todosB = {}',
    ].join('\n')

    it('两个表单容器快照逐条解析后合并——先合并再解析会因两个对象值键整体降级 null（E2E 实锤）', () => {
        const merged = resolveMergedSnapshotInjection(
            multiForm,
            [{ '$todosA': { a: true } }, { '$todosB': { b: false } }],
        )
        expect(merged).toEqual({ $todosA: { a: true }, $todosB: { b: false } })
    })

    it('对象容器与标量包混 合并（各操作表单形状不同）', () => {
        const merged = resolveMergedSnapshotInjection(
            multiForm,
            [{ '$todosA': { a: true } }, { '$actionState': 'idle', '$note': '备注' }],
        )
        expect(merged).toEqual({ $todosA: { a: true }, $note: '备注' })
    })

    it('全部无法解析（空/降级）→ null', () => {
        expect(resolveMergedSnapshotInjection(multiForm, [undefined, { '$actionState': 'running' }])).toBeNull()
        expect(resolveMergedSnapshotInjection(multiForm, [])).toBeNull()
    })
})
