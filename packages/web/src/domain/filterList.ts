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
 * 管理页列表通用过滤（架构深化候选②下沉）：按名字 + 描述大小写不敏感包含。
 * skill / mcp / plugin 各管理页的字段同构（name + description），谓词归各域调用方，
 * 匹配规则本身收在 domain 单源——迭代 2/3 免抄。
 */
export function filterByNameOrDescription<T extends { name: string; description?: string }>(
    items: T[],
    keyword: string,
): T[] {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
        item => item.name.toLowerCase().includes(needle) || (item.description?.toLowerCase().includes(needle) ?? false),
    )
}
