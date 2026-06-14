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
 * 生成 RFC 4122 v4 UUID
 *
 * 优先用 crypto.randomUUID()，但该方法仅在**安全上下文**（HTTPS 或 localhost）可用。
 * 通过局域网 IP + HTTP 访问（如 http://192.168.x.x:port）属于非安全上下文，
 * crypto.randomUUID 不存在，直接调用会抛 "crypto.randomUUID is not a function"。
 *
 * 本函数在非安全上下文下 fallback 到 crypto.getRandomValues 手动构造 v4 UUID
 * （getRandomValues 在所有上下文均可用），保证移动端 HTTP 调试也能正常工作。
 */
export function uuid(): string {
    // 安全上下文：crypto.randomUUID 可用
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    // 非安全上下文 fallback：getRandomValues 在所有上下文可用
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16))
        // RFC 4122 v4：version 位固定为 0100（0x40），variant 位固定为 10（0x80）
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
        return (
            hex.slice(0, 4).join('') +
            '-' +
            hex.slice(4, 6).join('') +
            '-' +
            hex.slice(6, 8).join('') +
            '-' +
            hex.slice(8, 10).join('') +
            '-' +
            hex.slice(10, 16).join('')
        )
    }

    // 最终 fallback：无 crypto API 的极端环境（极少见）
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}`
}
