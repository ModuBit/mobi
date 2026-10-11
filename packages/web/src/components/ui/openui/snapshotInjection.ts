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
 * initialState 注入解析（状态持久化票 02）：把派生出的 phase 与表单快照翻译成
 * react-lang initialState 的 `$` 键映射。纯函数、无 React 依赖，renderer 消费。
 *
 * 两个识别都基于 fence 源码（renderer 已持有）而非约定名字：
 * - 状态变量按**值域**识别——`$var = "idle|running|done|failed"` 声明即命中
 *   （E2E 实锤模型会自创 $mdState/$jsonState，硬编码 $actionState 会漏）；
 * - 表单快照的注入目标是源码中**唯一的空对象声明** `$var = {}`（表单绑定容器的
 *   惯用形态），命名表单取内层字段集注入；0/多个目标无法唯一定位 → null 静默
 *   降级（phase 照常，快照缺失只丢「刷新恢复勾选」这一增强）。
 */

/** 档③ phase 值域（单源于 bindingParser——绑定解析与快照回注共享同一词汇） */
export { PHASE_VALUES } from './bindingParser'
import { PHASE_VALUES } from './bindingParser'

/** `$var = "…" ` 字符串声明（捕获变量名与默认值） */
const STATE_VAR_DECL = /\$([A-Za-z]\w*)\s*=\s*"([^"]*)"/g
/** `$var = {}` 空对象声明（表单绑定容器的惯用形态） */
const EMPTY_OBJ_DECL = /\$([A-Za-z]\w*)\s*=\s*\{\}/g

/**
 * 识别源码中的状态变量（默认值 ∈ phase 值域的 `$` 变量），返回带 `$` 前缀的变量名。
 * `$actionState` 是命中的惯用特例，不是机制依赖。
 */
export function resolveStateActionVars(code: string): string[] {
    const out: string[] = []
    for (const m of code.matchAll(STATE_VAR_DECL)) {
        if (PHASE_VALUES.has(m[2]!)) out.push(`$${m[1]}`)
    }
    return out
}

/**
 * 解析表单快照 → 要并入 initialState 的 `$` 键映射；无法唯一定位注入目标 → null。
 * 按值形状分类而非先剥 `$` 键——react-lang 命名表单的 formName 本身就是 `$` 变量
 * （返回 `{ "$todos": {...} }`，E2E 实锤），盲目剥 `$` 会把唯一数据剥空：
 * - 恰有一个对象值键（命名表单容器，$ 或非 $ 名均可）且其余键全是 `$` 机制键 → 取内层
 * - 无对象值键（无名表单顶层）→ 剥 `$` 机制键后整体即字段集
 * - 其余形状（多个对象值键 / 对象值键与无名标量混杂）无法判定 → 降级
 */
export function resolveFormSnapshotInjection(
    code: string,
    formState: Record<string, unknown>,
): Record<string, unknown> | null {
    const isPlainObject = (v: unknown) => v != null && typeof v === 'object' && !Array.isArray(v)
    const entries = Object.entries(formState)
    if (entries.length === 0) return null
    const objectEntries = entries.filter(([, v]) => isPlainObject(v))
    const scalarEntries = entries.filter(([, v]) => !isPlainObject(v))

    let fields: Record<string, unknown> | null = null
    if (objectEntries.length === 1 && scalarEntries.every(([k]) => k.startsWith('$'))) {
        fields = objectEntries[0]![1] as Record<string, unknown>
    } else if (objectEntries.length === 0) {
        fields = Object.fromEntries(scalarEntries.filter(([k]) => !k.startsWith('$')))
        if (Object.keys(fields).length === 0) return null
    }
    if (fields == null) return null

    const containers = [...code.matchAll(EMPTY_OBJ_DECL)].map((m) => `$${m[1]}`)
    if (containers.length !== 1) return null
    return { [containers[0]!]: fields }
}
