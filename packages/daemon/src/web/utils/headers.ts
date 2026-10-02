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
 * 安全解码 HTTP header 值。
 *
 * decodeURIComponent 对非法 % 序列（'%zz'、末尾 '%'）抛 URIError，
 * 端点直接调用会导致未捕获异常 → Hono 500。此处吞错返回空串，
 * 让端点按「header 缺失」走 400，而非 500。
 */
export function safeDecodeHeader(value: string | null | undefined): string {
    if (!value) return ''
    try {
        return decodeURIComponent(value)
    } catch {
        return ''
    }
}
