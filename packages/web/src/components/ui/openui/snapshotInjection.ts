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
 * initialState 注入解析（状态持久化票 02，per-action 票 03 起按快照形状收敛）：
 * 把派生出的表单快照翻译成 react-lang initialState 的 `$` 键映射。纯函数、
 * 无 React 依赖，renderer 消费。
 *
 * 快照键集 = react-lang getFormPayload 的返回形状（键即表单绑定变量名，带 `$`，
 * E2E 实锤 `{ "$todos": {...} }`），按值形状分类：
 * - 对象值键 = 命名表单容器，键原样回注（forms 提供时校验归属，伪造/无关键 →
 *   整体 null 静默降级）；盲目剥 `$` 会把唯一数据剥空
 * - 标量值键 = 直接绑定 `$var` 的字段原样回注；值 ∈ phase 值域的标量键是状态
 *   机制变量瞬态，剔除——否则回注以 idle 覆盖派生的 done，一次性操作按钮
 *   解锁定复开
 * 非 `$` 键不是 react-lang 的产出，无注入目标，忽略（legacy 容器定位通道随
 * 63aacaa5「生产未部署无旧数据」裁决删除）。
 */

/** 档③ phase 值域（单源于 bindingParser——绑定解析与快照回注共享同一词汇） */
export { PHASE_VALUES } from './bindingParser'
import { PHASE_VALUES } from './bindingParser'
import { STATE_VAR_RE } from '@mobi/shared'

/** `$var` 合法标识符形状 = shared STATE_VAR_RE（与 daemon zod 校验同一正则，
 *  两端漂移会造成「daemon 收下、回注拒绝」的静默失败） */
const SNAPSHOT_KEY_RE = STATE_VAR_RE

/**
 * 解析表单快照 → 要并入 initialState 的 `$` 键映射；无可回注数据 → null。
 */
export function resolveFormSnapshotInjection(
    formState: Record<string, unknown>,
    forms?: Map<string, string[]>,
): Record<string, unknown> | null {
    const isPlainObject = (v: unknown) => v != null && typeof v === 'object' && !Array.isArray(v)
    const entries = Object.entries(formState).filter(([key]) => SNAPSHOT_KEY_RE.test(key))
    if (entries.length === 0) return null
    const knownFormVars = forms !== undefined && forms.size > 0 ? new Set([...forms.values()].flat()) : null

    const out: Record<string, unknown> = {}
    for (const [key, value] of entries) {
        if (isPlainObject(value)) {
            if (knownFormVars !== null && !knownFormVars.has(key)) return null
            out[key] = value
        } else if (!PHASE_VALUES.has(String(value))) {
            out[key] = value
        }
    }
    return Object.keys(out).length > 0 ? out : null
}

/**
 * per-action 多快照合并回注（renderer 消费）：各操作的快照逐条解析后合并注入
 * 映射。不能先合并原始快照再解析——两个表单容器（两个对象值键）会破坏归属
 * 校验（E2E 实锤）。全部无法解析 → null。
 */
export function resolveMergedSnapshotInjection(
    snapshots: ReadonlyArray<Record<string, unknown> | undefined>,
    forms?: Map<string, string[]>,
): Record<string, unknown> | null {
    let merged: Record<string, unknown> | null = null
    for (const snap of snapshots) {
        if (snap === undefined) continue
        const injection = resolveFormSnapshotInjection(snap, forms)
        if (injection === null) continue
        if (merged === null) {
            merged = injection
            continue
        }
        merged = { ...merged, ...injection }
    }
    return merged
}
