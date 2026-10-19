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
 * openui 自定义函数的公共 schema 与辅助函数（票 02 移植）。
 *
 * 来源：thesysdev/open-intelligent-ui（MIT）`src/lib/functions/shared.ts`，
 * 逐函数移植、保持行为一致；完整许可声明见本目录 index.ts 文件头。
 * 差异仅在类型收窄（strict TS：裸 `Record` / `Map` 补泛型）与注释中文化。
 */

import { z } from 'zod'

export const list = () => z.array(z.any())
export const numbers = () => z.array(z.number())
export const date = () => z.union([z.string(), z.number()])
export const agg = () => z.enum(['sum', 'avg', 'count', 'min', 'max'])

/** 读取行的 `field` 字段，支持点路径；`""` 表示行本身（与 @Filter 同口径） */
export function read(item: unknown, field: string): unknown {
    if (!field) return item
    let cur: unknown = item
    for (const key of field.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[key]
    }
    return cur
}

/**
 * 按值相等：列表与对象逐项比较，数字与它的字符串形式也算相等
 * （表单输入的 id 常常是字符串）。
 */
export function same(a: unknown, b: unknown): boolean {
    if (a === b) return true
    const mixed =
        (typeof a === 'number' && typeof b === 'string') ||
        (typeof a === 'string' && typeof b === 'number')
    if (mixed) return String(a) === String(b)
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
        return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]))
    }
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return (
        ka.length === kb.length &&
        ka.every((k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    )
}

/** 有限数或抛错（运行时把 throw 转成 null）——NaN / Infinity 不得进入 UI */
export function finite(value: number): number {
    if (!Number.isFinite(value)) throw new Error('result is not a finite number')
    return value
}

/** 宽松转数字：数字或可解析的字符串 → 有限数，其余 → null */
export function toNum(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        return Number.isFinite(n) ? n : null
    }
    return null
}

export type Agg = 'sum' | 'avg' | 'count' | 'min' | 'max'

/** 聚合行上 `field` 读出的数字；count 数行数 */
export function aggregate(rows: unknown[], field: string | undefined, how: Agg): number {
    if (how === 'count') return rows.length
    const values = rows.map((r) => toNum(read(r, field ?? ''))).filter((v): v is number => v !== null)
    if (!values.length) return 0
    switch (how) {
        case 'sum':
            return values.reduce((a, b) => a + b, 0)
        case 'avg':
            return values.reduce((a, b) => a + b, 0) / values.length
        case 'min':
            return Math.min(...values)
        case 'max':
            return Math.max(...values)
    }
}

/** 按 key 分组，保持首次出现顺序；空值归入 "Unknown"，数字键保留数字形态 */
export function groups(rows: unknown[], key: string): Map<string | number, unknown[]> {
    const out = new Map<string | number, unknown[]>()
    for (const row of rows) {
        const raw = read(row, key)
        const k = typeof raw === 'number' ? raw : raw == null || raw === '' ? 'Unknown' : String(raw)
        const bucket = out.get(k)
        if (bucket) bucket.push(row)
        else out.set(k, [row])
    }
    return out
}

/** 单个函数的产出上限：防模型生成超大数组拖垮浏览器 */
export const MAX_ITEMS = 10000
