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

import type { Database } from 'bun:sqlite'

import type { VersionedUpdateResult } from './types'

type VersionedUpdateArgs<T> = {
    /** SQLite 数据库实例 */
    db: Database
    /** 要更新的表名 */
    table: string
    /** 记录的唯一标识 */
    id: string
    /** 命名空间，用于数据隔离 */
    namespace: string
    /** 要更新的字段名 */
    field: string
    /** 版本号字段名，用于乐观锁控制 */
    versionField: string
    /** 期望的当前版本号，用于检测并发冲突 */
    expectedVersion: number
    /** 要更新的新值 */
    value: T
    /** 将值编码为数据库存储格式（如 JSON 字符串） */
    encode: (value: T) => string | null
    /** 将数据库值解码为原始类型 */
    decode: (value: string | null) => T
    /** 额外的 SET 子句（如 'updated_at = @updated_at'） */
    setClauses?: string[]
    /** 额外子句对应的参数值 */
    params?: Record<string, unknown>
}

export function updateVersionedField<T>(args: VersionedUpdateArgs<T>): VersionedUpdateResult<T> {
    try {
        const setClauses = [
            `${args.field} = @field_value`,
            `${args.versionField} = ${args.versionField} + 1`,
            ...(args.setClauses ?? [])
        ]

        const result = args.db.prepare(
            `UPDATE ${args.table}
             SET ${setClauses.join(', ')}
             WHERE id = @id AND namespace = @namespace AND ${args.versionField} = @expectedVersion`
        ).run({
            id: args.id,
            namespace: args.namespace,
            expectedVersion: args.expectedVersion,
            field_value: args.encode(args.value),
            ...(args.params ?? {})
        })

        if (result.changes === 1) {
            return { result: 'success', version: args.expectedVersion + 1, value: args.value }
        }

        const current = args.db.prepare(
            `SELECT ${args.field} AS field_value, ${args.versionField} AS version
             FROM ${args.table}
             WHERE id = ? AND namespace = ?`
        ).get(args.id, args.namespace) as { field_value: string | null; version: number } | undefined

        if (!current) {
            return { result: 'error' }
        }

        return {
            result: 'version-mismatch',
            version: current.version,
            value: args.decode(current.field_value)
        }
    } catch {
        return { result: 'error' }
    }
}
