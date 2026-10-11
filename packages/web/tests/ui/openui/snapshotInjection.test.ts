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
import { resolveStateActionVars, resolveFormSnapshotInjection } from '@/components/ui/openui/snapshotInjection'

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
})
