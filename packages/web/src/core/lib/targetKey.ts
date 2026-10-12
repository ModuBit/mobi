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
 * DiffTarget ↔ 序列化键的互逆对（src 分层治理票 01 自 review/reviewEntries 下沉）。
 * 菜单 key / query key / viewState 共用的 wire 契约——缓存寻址属 core 基建，
 * 归 core 自持后 query-keys 不再反向依赖业务 UI（components/review）。
 */

import { DiffTargetSchema, type DiffTarget } from '@mobi/shared'

/** DiffTarget → 序列化键（与 parseTargetKey 互逆） */
export function serializeTargetKey(target: DiffTarget): string {
    return JSON.stringify(target)
}

/** Select 序列化键 → DiffTarget（损坏输入抛错，调用方吞掉不切档） */
export function parseTargetKey(key: string): DiffTarget {
    return DiffTargetSchema.parse(JSON.parse(key))
}
