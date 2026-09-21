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
 * XML 文本转义（& " < >）——cli 包内「prompt / 信封内嵌自由文本防标签逃逸」的唯一实现。
 *
 * `&` 必须最先替换：放后面会把刚生成的实体（如 `&quot;`）里的 `&` 再转义一遍，
 * 变成 `&amp;quot;`。转义字符集是最怕漂移的安全原语，新增调用方直接复用，不要再抄一份。
 *
 * 注：claudeRemote 的 bash 输出转义（仅 & < >，控制 token 膨胀）与 serviceManager 的
 * plist 转义（含 '，属 XML 属性位）字符集是按场景有意收窄/扩展的，不在此收口范围。
 */
export function escapeXmlText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}
