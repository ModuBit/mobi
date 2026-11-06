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
 * 中和不可信文本里的指定标记：把 `<tag …>` / `</tag>` 的尖括号换成实体，让它们
 * 只剩「看着像标记的文字」——内容照常可读，但不再是标记。
 *
 * 开标签可能带属性（`<tag attr="…">`），所以整对尖括号一起换，而不是只换标签名前面
 * 那个 `<`——后者会留下一个孤零零的 `>`，看着像半个标记。
 *
 * 这是**提高门槛**而非绝对防御：全角字符之类的把戏仍可绕过，适用于「对面不是专门
 * 与我为敌的攻击者」的威胁模型（跨会话发送方、用户自定义 system prompt 段）。
 * tags 是代码常量，不做正则元字符转义。
 */
export function neutralizeTags(text: string, tags: readonly string[]): string {
    return tags.reduce(
        (acc, tag) => acc.replace(new RegExp(`<(/?)${tag}([^>]*)>`, 'g'), `&lt;$1${tag}$2&gt;`),
        text,
    )
}
