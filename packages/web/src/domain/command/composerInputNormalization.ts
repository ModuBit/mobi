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
 * composer 中文 IME 输入归一（单一来源）
 *
 * 中文输入法下部分按键输出的标点与 CC 命令语法冲突，此处集中承载「输入值 → 归一值」
 * 规则；composer 的 handleChange 按序调用本模块的归一器，自身不再内联任何中文适配逻辑
 * （归一散落内联的下场见 ChatComposer 历史：「！」归一曾与顿号归一驻留两个深度）。
 * 适配清单来源：docs/research-zcode-interactions.md §三。
 */

/**
 * 行首顿号归一为「/」（中文输入法按 / 键输出「、」，斜杠命令面板永远唤不起来）。
 *
 * 只拦截「本次变更恰好是在开头插入一个顿号」的手输场景——粘贴以顿号开头的整段文本、
 * 正文中间的顿号、前值本就以顿号开头的连续输入，都不动。
 *
 * @returns 归一后的新值；非手输顿号场景返回 null（调用方保持原值）
 */
export function normalizeLeadingChineseSlash(value: string, previousValue: string): string | null {
    if (!value.startsWith('、')) return null
    if (previousValue.startsWith('、')) return null
    if (value !== '、' + previousValue) return null
    return '/' + previousValue
}

/**
 * 行首全角感叹号+空格归一为「! 」（中文输入法打不出半角「!」，bash 前缀模式唤不起来）。
 *
 * 不比对 previousValue：CC 的 bash 前缀是「! 」开头，IME 上屏的「！ 」只会出现在
 * 用户主动切换 bash 模式的意图下，正文以「！ 」开头的中文极其罕见且可手动改回。
 * previousValue 入参只为与其他归一器同形（管线统一调用），不参与判定。
 *
 * @returns 归一后的新值；非「！ 」开头返回 null（调用方保持原值）
 */
export function normalizeLeadingChineseExclamation(value: string, _previousValue: string): string | null {
    if (!value.startsWith('！ ')) return null
    return '! ' + value.slice(2)
}
