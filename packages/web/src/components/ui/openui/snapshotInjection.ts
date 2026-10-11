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

/** `$var` 合法标识符形状（命名表单快照键的原样回注判据） */
const SNAPSHOT_KEY_RE = /^\$[A-Za-z]\w*$/

/**
 * 解析表单快照 → 要并入 initialState 的 `$` 键映射；无法唯一定位注入目标 → null。
 * 按值形状分类而非先剥 `$` 键——react-lang 的载荷键就是 `$` 变量名（返回
 * `{ "$todos": {...} }`，E2E 实锤），盲目剥 `$` 会把唯一数据剥空：
 * - `$` 标识符键直接回注：对象值键是命名表单容器（键即绑定变量名，forms 提供
 *   时校验归属，伪造/无关键 → 整体降级 null）；标量值键是直接绑定 `$var` 的字段
 *   原样回注。值 ∈ phase 值域的标量键是状态机制变量瞬态，剔除——否则回注以
 *   idle 覆盖派生的 done，一次性操作按钮解锁定复开
 * - 非 `$` 键走既有容器定位语义：唯一对象值 = 命名表单字段集、纯标量 = 无名表单
 *   字段，注入源码中唯一的空对象声明 `$` 变量（0/多个 → null）
 * - 混合包（容器 + 标量字段共存，E2E 实锤 `{ $subscribe, $contact, $formAState }`
 *   形状）：两桶各自解析后合并——容器键与标量键都是独立 initialState 键
 */
export function resolveFormSnapshotInjection(
    code: string,
    formState: Record<string, unknown>,
    forms?: Map<string, string[]>,
): Record<string, unknown> | null {
    const isPlainObject = (v: unknown) => v != null && typeof v === 'object' && !Array.isArray(v)
    const entries = Object.entries(formState)
    if (entries.length === 0) return null
    const knownFormVars = forms !== undefined && forms.size > 0 ? new Set([...forms.values()].flat()) : null

    const direct: Record<string, unknown> = {}
    const legacyEntries: Array<[string, unknown]> = []
    for (const [key, value] of entries) {
        if (SNAPSHOT_KEY_RE.test(key)) {
            if (isPlainObject(value)) {
                if (knownFormVars !== null && !knownFormVars.has(key)) return null
                direct[key] = value
            } else if (!PHASE_VALUES.has(String(value))) {
                direct[key] = value
            }
        } else {
            legacyEntries.push([key, value])
        }
    }
    if (legacyEntries.length === 0) return Object.keys(direct).length > 0 ? direct : null

    const legacyObjects = legacyEntries.filter(([, v]) => isPlainObject(v))
    const legacyScalars = legacyEntries.filter(([, v]) => !isPlainObject(v))
    let fields: Record<string, unknown> | null = null
    if (legacyObjects.length === 1 && legacyScalars.length === 0) fields = legacyObjects[0]![1] as Record<string, unknown>
    else if (legacyObjects.length === 0 && legacyScalars.length > 0) fields = Object.fromEntries(legacyScalars)
    if (fields === null) return null

    // 容器定位通道：源码唯一空对象声明（无名表单 / 非 $ 形状命名键的既有语义）
    const containers = [...code.matchAll(EMPTY_OBJ_DECL)].map((m) => `$${m[1]}`)
    if (containers.length !== 1) return null
    return { ...direct, [containers[0]!]: fields }
}

/**
 * per-action 多快照合并回注（renderer 消费）：各操作的快照**逐条解析后合并**注入
 * 映射。不能先合并原始快照再解析——两个表单容器（两个对象值键）会破坏「唯一对象
 * 值键」判据整体降级 null，双表单的值全丢（2026-10-11 E2E 实锤：锁定靠 derive
 * 恢复正常，值静默丢失）。全部无法解析 → null。
 */
export function resolveMergedSnapshotInjection(
    code: string,
    snapshots: ReadonlyArray<Record<string, unknown> | undefined>,
    forms?: Map<string, string[]>,
): Record<string, unknown> | null {
    let merged: Record<string, unknown> | null = null
    for (const snap of snapshots) {
        if (snap === undefined) continue
        const injection = resolveFormSnapshotInjection(code, snap, forms)
        if (injection === null) continue
        if (merged === null) {
            merged = injection
            continue
        }
        merged = { ...merged, ...injection }
    }
    return merged
}
