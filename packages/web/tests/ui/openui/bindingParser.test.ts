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
 * 操作绑定解析规格（per-action 状态粒度票 01）：
 * resolveActionBindings 把 fence 源码解析成「操作绑定表」——host 侧 per-action
 * 状态识别与快照回注的唯一事实源：
 * - setTargets：各 Button 的 Action 里 `Set($x, …)` 的目标变量（身份判定首选，
 *   教学句式保证存在；react-lang 运行时实证 Set 先于 ToAssistant 执行）
 * - stateVars：全部值域命中的状态变量（Set 目标 ∪ label/action 表达式引用；
 *   parser 已把 label 变量定义内联进 Button 节点，无需自行追派生链）
 * - forms：`Form("name", …, $var)` 的 formName → 变量映射（快照精确回注）
 * 解析失败/无 Button → 空表（调用方降级块级行为），不 throw。
 */

import { describe, it, expect } from 'vitest'
import { resolveActionBindings } from '@/ui/openui/bindingParser'

/** E2E 实锤的双卡源码（11:44 现场）：md 卡带 Set 教学句式，json 卡无 Set */
const DUAL_CARD = [
    'root = Stack([mdCard, jsonCard], "row", "m")',
    'mdCard = Card([mdStatusRow, mdBtn], "card")',
    'mdBtn = Button(mdBtnLabel, Action([Set($mdState, "running"), @ToAssistant("数一下 md 文件")]), "primary")',
    'mdBtnLabel = $mdState == "done" ? "已完成 ✓" : ($mdState == "running" ? "执行中…" : "开始统计")',
    '$mdState = "idle"',
    'jsonCard = Card([jsonStatusRow, jsonBtn], "card")',
    'jsonBtn = Button(jsonBtnLabel, Action([@ToAssistant("数一下 json 文件")]), "primary")',
    'jsonBtnLabel = $jsonState == "done" ? "已完成 ✓" : ($jsonState == "running" ? "执行中…" : "开始统计")',
    '$jsonState = "idle"',
].join('\n')

describe('resolveActionBindings', () => {
    it('双卡源码解出两个独立状态变量（E2E 实锤现场）', () => {
        const b = resolveActionBindings(DUAL_CARD)
        expect(b.stateVars).toEqual(expect.arrayContaining(['$mdState', '$jsonState']))
        // 只有 md 卡用了 Set 教学句式
        expect(b.setTargets).toEqual(['$mdState'])
    })

    it('label 间接派生：Button(mdBtnLabel, …) 经 parser 内联追到 $mdState', () => {
        const b = resolveActionBindings(DUAL_CARD)
        expect(b.stateVars).toContain('$mdState')
    })

    it('Set 目标直接命中教学句式', () => {
        const code = 'btn = Button("go", Action([Set($actionState, "running"), @ToAssistant("go")]), "primary")\n$actionState = "idle"'
        expect(resolveActionBindings(code).setTargets).toEqual(['$actionState'])
    })

    it('值域过滤：默认值不在值域的变量不进 stateVars', () => {
        const code = 'btn = Button(btnLabel, Action([@ToAssistant("x")]), "primary")\nbtnLabel = $name == "张三" ? "a" : "b"\n$name = "李四"'
        const b = resolveActionBindings(code)
        expect(b.stateVars).toEqual([])
        expect(b.setTargets).toEqual([])
    })

    it('Form 绑定：子树内控件 value prop 的数据变量归属 formName（运行时实证——Form 本身无绑定参）', () => {
        const code = [
            'root = Card([todoForm])',
            'todoForm = Form("todo-panel", Buttons([submitBtn]), [checks, submitBtn])',
            'checks = CheckBoxGroup("todos", [a, b], null, $todos)',
            'submitBtn = Button("提交", Action([@ToAssistant("submit")]), "primary")',
            '$todos = {}',
        ].join('\n')
        expect(resolveActionBindings(code).forms.get('todo-panel')).toEqual(['$todos'])
    })

    it('Form 子树内的值域变量不归 forms（那是操作状态不是表单数据）', () => {
        const code = [
            'root = Card([todoForm])',
            'todoForm = Form("todo-panel", Buttons([submitBtn]), [statusLabel])',
            'statusLabel = $actionState == "done" ? "已提交 ✓" : "待提交"',
            'submitBtn = Button("提交", Action([Set($actionState, "running"), @ToAssistant("submit")]), "primary")',
            '$actionState = "idle"',
        ].join('\n')
        expect(resolveActionBindings(code).forms.size).toBe(0)
        expect(resolveActionBindings(code).setTargets).toEqual(['$actionState'])
    })

    it('非法源码 → 空表不 throw', () => {
        const b = resolveActionBindings('this is not = === valid openui')
        expect(b.setTargets).toEqual([])
        expect(b.stateVars).toEqual([])
        expect(b.forms.size).toBe(0)
    })

    it('无 Button 无 Form（纯展示）→ 空表', () => {
        const b = resolveActionBindings('root = Card([CardHeader("标题", "副标题")])')
        expect(b.setTargets).toEqual([])
        expect(b.stateVars).toEqual([])
        expect(b.forms.size).toBe(0)
    })

    it('空源码 → 空表', () => {
        const b = resolveActionBindings('')
        expect(b.setTargets).toEqual([])
        expect(b.stateVars).toEqual([])
        expect(b.forms.size).toBe(0)
    })
})
