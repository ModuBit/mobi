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

import { AnsiUp } from 'ansi_up'

/**
 * 将包含 ANSI 转义码的文本转换为 HTML
 * 每次调用创建新实例，避免有状态 parser 的格式泄漏
 */
export function ansiToHtml(text: string): string {
    const up = new AnsiUp()
    up.escape_html = true
    return up.ansi_to_html(text)
}
