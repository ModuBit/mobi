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
 * 操作绑定解析（per-action 状态粒度票 01）：把 fence 源码解析成「操作绑定表」——
 * host 侧 per-action 状态识别与快照回注的唯一事实源。纯函数、无 React 依赖。
 *
 * 基于react-lang 公开 parse 管线（createParser(openuiLibrary.toJSONSchema())），
 * 三个运行时实证事实是本模块的根基（先于实现实测，见票 01）：
 * 1. ElementNode 带 statementId，label 变量定义被 parser **内联**进 Button 节点
 *    （`Button(mdBtnLabel, …)` 的 props.label 直接是完整 Ternary 表达式）——
 *    无需自行追派生链，全树 StateRef 收集即覆盖 label 引用；
 * 2. `Set($x, …)` step 在 Action 数组里是固定形状 `[Ph("Set"), StateRef(var), …]`
 *    ——全树扫该模式即得 setTargets（教学句式保证存在，事件身份判定的首选）；
 * 3. Form 本身无绑定参数（schema 只有 name/buttons/fields），表单数据变量绑定在
 *    控件的 value prop（如 `CheckBoxGroup(…, $todos)` → props.value = StateRef）
 *    ——Form 子树内的非值域 $ 变量即该表单的数据容器，formName 靠子树归属。
 *
 * 解析失败 / 无 Button / 无绑定 → 空表（调用方降级为块级行为），不 throw。
 */

import { createParser, type ElementNode, type ParseResult } from '@openuidev/react-lang'
import { openuiLibrary } from '@openuidev/react-ui'

/** 档③ phase 值域（与 catalog prompt 教学、renderer 注入共享的词汇） */
export const PHASE_VALUES = new Set(['idle', 'running', 'done', 'failed'])

/** 操作绑定表：per-action 状态识别与快照回注的事实源 */
export interface ActionBindings {
    /** 各操作 Action 里 `Set($x, …)` 的目标变量（身份判定首选；教学句式保证存在） */
    setTargets: string[]
    /** 全部操作状态变量（Set 目标 ∪ label/action 表达式引用，值域过滤后） */
    stateVars: string[]
    /** Button statementId → 该操作绑定的状态变量（Set 目标优先；无 Set 时子树内
     *  唯一值域变量兜底，无法唯一定位不入表）——事件点击身份（statementId registry
     *  通道，见 mobiLibrary）回查的映射 */
    actions: Map<string, string>
    /** formName → 该表单子树内的数据容器变量（快照精确回注） */
    forms: Map<string, string[]>
}

const EMPTY_BINDINGS: ActionBindings = { setTargets: [], stateVars: [], actions: new Map(), forms: new Map() }

/** parser 单例（schema 构建昂贵；parse 本身无状态） */
let parser: ReturnType<typeof createParser> | null = null

function getParser(): ReturnType<typeof createParser> {
    parser ??= createParser(openuiLibrary.toJSONSchema())
    return parser
}

/** 表达式 AST 节点判别（lang-core 的 k 判别字段约定） */
function isExprNode(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && 'k' in value && typeof (value as Record<string, unknown>).k === 'string'
}

function isStateRef(node: Record<string, unknown>): node is { k: 'StateRef'; n: string } {
    return node.k === 'StateRef' && typeof node.n === 'string'
}

/** 收集器：单次 walk 的累积状态 */
interface Collector {
    stateRefs: Set<string>
    setTargets: Set<string>
    /** Button statementId → 子树内 Set 目标（教学句式） */
    buttonSets: Map<string, string>
    /** Button statementId → 子树内 StateRef 引用集（无 Set 时唯一值域变量兜底的原料） */
    buttonRefs: Map<string, Set<string>>
    /** formName → 数据容器变量（收集期，后聚合为 Map） */
    formRefs: Array<{ formName: string; ref: string }>
}

/**
 * 递归 walk：element 节点下钻 props（Form 记 formName 上下文、Button 记 statementId
 * 上下文），表达式节点按 k 判别收集 StateRef 与 `Set` 目标模式。Button 嵌套 Button
 * 非 DSL 形态，出现时内层后写覆盖（可接受边缘）。
 */
function walk(node: unknown, formName: string | null, buttonId: string | null, out: Collector): void {
    if (node == null || typeof node !== 'object') return
    if (Array.isArray(node)) {
        for (const item of node) walk(item, formName, buttonId, out)
        return
    }
    const rec = node as Record<string, unknown>
    if (rec.type === 'element' && typeof rec.typeName === 'string') {
        const el = rec as unknown as ElementNode
        const isButton = el.typeName === 'Button' && typeof el.statementId === 'string'
        const innerForm = el.typeName === 'Form' && typeof el.props.name === 'string' ? el.props.name : formName
        const innerButton = isButton ? (el.statementId as string) : buttonId
        for (const value of Object.values(el.props)) walk(value, innerForm, innerButton, out)
        return
    }
    if (!isExprNode(rec)) {
        // props 容器对象（非表达式叶子）——继续下钻其字段
        for (const value of Object.values(rec)) walk(value, formName, buttonId, out)
        return
    }
    if (isStateRef(rec)) {
        out.stateRefs.add(rec.n)
        if (formName !== null) out.formRefs.push({ formName, ref: rec.n })
        if (buttonId !== null) {
            const refs = out.buttonRefs.get(buttonId)
            if (refs === undefined) out.buttonRefs.set(buttonId, new Set([rec.n]))
            else refs.add(rec.n)
        }
        return
    }
    // `Set` step 模式：数组里 Ph("Set") 后紧跟目标 StateRef（parser 实证形状）
    if (rec.k === 'Arr' && Array.isArray(rec.els)) {
        const els = rec.els as unknown[]
        for (let i = 0; i < els.length - 1; i++) {
            const cur = els[i]
            const next = els[i + 1]
            if (
                isExprNode(cur) && cur.k === 'Ph' && cur.n === 'Set'
                && isExprNode(next) && isStateRef(next)
            ) {
                out.setTargets.add(next.n)
                if (buttonId !== null) out.buttonSets.set(buttonId, next.n)
            }
        }
    }
    for (const value of Object.values(rec)) walk(value, formName, buttonId, out)
}

/**
 * 解析 fence 源码 → 操作绑定表。解析失败（非法源码/空输入）返回空表——调用方
 * 降级为块级行为（现状语义），不 throw。
 */
export function resolveActionBindings(code: string): ActionBindings {
    if (code.trim().length === 0) return EMPTY_BINDINGS
    let result: ParseResult
    try {
        result = getParser().parse(code)
    } catch {
        return EMPTY_BINDINGS
    }
    if (result.root === null) return EMPTY_BINDINGS

    const out: Collector = { stateRefs: new Set(), setTargets: new Set(), buttonSets: new Map(), buttonRefs: new Map(), formRefs: [] }
    walk(result.root, null, null, out)

    // 值域过滤：stateDeclarations 是变量默认值的权威（声明未达/未定义引用天然排除）
    const declarations = result.stateDeclarations as Record<string, unknown>
    const phaseVars = new Set(
        Object.keys(declarations).filter((name) => declarations[name] != null && PHASE_VALUES.has(String(declarations[name]))),
    )
    const dataVars = new Set(Object.keys(declarations).filter((name) => !phaseVars.has(name)))

    // 操作映射：Set 目标优先；无 Set 的 Button 取子树内唯一值域变量（无法唯一定位不入表——
    // 身份推断将对该操作降级块级）
    const actions = new Map<string, string>()
    for (const [id, target] of out.buttonSets) {
        if (phaseVars.has(target)) actions.set(id, target)
    }
    for (const [id, refs] of out.buttonRefs) {
        if (actions.has(id)) continue
        const phaseRefs = [...refs].filter((name) => phaseVars.has(name))
        if (phaseRefs.length === 1) actions.set(id, phaseRefs[0]!)
    }

    const forms = new Map<string, string[]>()
    for (const { formName, ref } of out.formRefs) {
        // Form 子树内非值域 $ 变量 = 表单数据容器（值域变量是操作状态，不归表单）
        if (!dataVars.has(ref)) continue
        const refs = forms.get(formName)
        if (refs === undefined) forms.set(formName, [ref])
        else if (!refs.includes(ref)) refs.push(ref)
    }

    return {
        setTargets: [...out.setTargets].filter((name) => phaseVars.has(name)),
        stateVars: [...out.stateRefs].filter((name) => phaseVars.has(name)),
        actions,
        forms,
    }
}
