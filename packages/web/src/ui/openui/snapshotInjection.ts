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
 * initialState 注入解析（状态持久化票 02，per-action 票 03 起按快照形状收敛；
 * 1.0 升级票补 react-lang 1.0 嵌套形状通道）：把派生出的表单快照翻译成
 * react-lang initialState 的键映射。纯函数、无 React 依赖，renderer 消费。
 *
 * 快照形状两代（1.0 升级 breaking 面实录，E2E 双实锤）：
 * - 0.x：`{ "$todos": {...} }` 平铺 `$` 键——键即绑定变量名。对象值 = 命名表单
 *   容器（forms 提供时校验归属，无关键只丢自己——快照常混着历史残留，整体降级
 *   会连坐其余有效表单，2026-10-19 code-review 修正）；标量值 =
 *   直接绑定字段原样回注；值 ∈ phase 值域的标量键是状态机制变量瞬态，剔除——
 *   否则回注以 idle 覆盖派生的 done，一次性操作按钮解锁定复开
 * - 1.0：`{ deploy: { serviceName: { value } } }` 嵌套——顶层键 = formName（无
 *   `$`，getFormPayload(formName) 的新形状）。initialState 对无 `$` 键走
 *   store.set 通道原样回注，判定 = 字段值全为对象包裹（{ value } 形状）；归属
 *   校验按 forms 的键（formName）而非值。字段含标量的非 `$` 对象不是任一代的
 *   产出，忽略（legacy 容器定位通道随 63aacaa5 裁决删除）
 */

/** 档③ phase 值域（单源于 bindingParser——绑定解析与快照回注共享同一词汇） */
export { PHASE_VALUES } from './bindingParser'
import { PHASE_VALUES } from './bindingParser'
import { STATE_VAR_RE } from '@mobi/shared'

/** `$var` 合法标识符形状 = shared STATE_VAR_RE（与 daemon zod 校验同一正则，
 *  两端漂移会造成「daemon 收下、回注拒绝」的静默失败） */
const SNAPSHOT_KEY_RE = STATE_VAR_RE

/**
 * 解析表单快照 → 要并入 initialState 的键映射；无可回注数据 → null。
 */
export function resolveFormSnapshotInjection(
    formState: Record<string, unknown>,
    forms?: Map<string, string[]>,
): Record<string, unknown> | null {
    const isPlainObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v)
    const knownFormVars = forms !== undefined && forms.size > 0 ? new Set([...forms.values()].flat()) : null
    const knownFormNames = forms !== undefined && forms.size > 0 ? new Set(forms.keys()) : null

    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formState)) {
        if (SNAPSHOT_KEY_RE.test(key)) {
            // 0.x 平铺 $ 键（bindingDefaults 通道）；归属不明的键只丢自己——
            // 快照常混着已改名/删除表单的历史残留，整体降级会连坐其余有效表单
            if (isPlainObject(value)) {
                if (knownFormVars !== null && !knownFormVars.has(key)) continue
                out[key] = value
            } else if (!PHASE_VALUES.has(String(value))) {
                out[key] = value
            }
        } else if (isPlainObject(value)) {
            // 1.0 嵌套形状（store.set 通道）：formName → field → { value } 包裹；
            // 字段含标量的对象不是任一代产出，忽略；归属不明的 formName 同样只丢自己
            const fields: unknown[] = Object.values(value)
            if (fields.length === 0 || !fields.every(isPlainObject)) continue
            if (knownFormNames !== null && !knownFormNames.has(key)) continue
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
