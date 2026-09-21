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
 * 预览截断（web 内「长文截短 + 省略号」的唯一实现）：超长原文只展示前 maxChars 个
 * 字符 + 省略号。按码点切（Array.from），emoji 等代理对不会被从中间截成乱码。
 * 使用方：rewind/fork 确认视图预览、气泡引用条目预览等。
 */
export function truncatePreview(text: string, maxChars: number): string {
    const chars = Array.from(text)
    return chars.length <= maxChars ? text : `${chars.slice(0, maxChars).join('')}…`
}
