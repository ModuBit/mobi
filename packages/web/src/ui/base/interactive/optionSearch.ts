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
 * 选择器候选的统一键入匹配：label 与 keywords 逐项大小写不敏感 includes。
 * MultiSelect（仅 label）与 Combobox（label + keywords）共用； MorphSelect 的
 * matches 额外拼接 description/meta（多词 needle 语义不同），维持自有实现。
 * needle 规整（trim + 小写）与匹配分两步——规整一次，逐候选匹配时不重复分配。
 */
export interface OptionSearchable {
    label: string;
    keywords?: readonly string[];
}

export function normalizeNeedle(query: string): string {
    return query.trim().toLocaleLowerCase();
}

export function optionMatches(option: OptionSearchable, normalizedNeedle: string): boolean {
    if (!normalizedNeedle) return true;
    return [option.label, ...(option.keywords ?? [])].some((term) => term.toLocaleLowerCase().includes(normalizedNeedle));
}
