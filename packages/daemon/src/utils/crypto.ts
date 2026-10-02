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

import { randomBytes, timingSafeEqual } from 'node:crypto'

export function constantTimeEquals(a: string | null | undefined, b: string | null | undefined): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false
    }

    const bufferA = Buffer.from(a, 'utf8')
    const bufferB = Buffer.from(b, 'utf8')
    const maxLength = Math.max(bufferA.length, bufferB.length)
    const paddedA = Buffer.alloc(maxLength)
    const paddedB = Buffer.alloc(maxLength)

    bufferA.copy(paddedA)
    bufferB.copy(paddedB)

    const matches = timingSafeEqual(paddedA, paddedB)
    return matches && bufferA.length === bufferB.length
}

/**
 * 生成密码学安全的随机 token（32 字节，base64url 编码 ≈ 43 字符）。
 * CLI 密钥与 Web 密钥的生成都用它，避免格式漂移导致校验不一致。
 */
export function generateSecureToken(): string {
    return randomBytes(32).toString('base64url')
}
