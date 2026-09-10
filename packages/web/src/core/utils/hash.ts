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
 * djb2 稳定字符串哈希——同一字符串恒得同一值（确定性，非密码学）。
 * 供「按 id 派生稳定伪随机」场景使用（如 twinkle 相位错开）；
 * composer/agentPalette.ts 内有一份同族实现，收敛时以此为准。
 */
export function stableHash(input: string): number {
    let h = 5381
    for (let i = 0; i < input.length; i++) h = (h * 33 + input.charCodeAt(i)) >>> 0
    return h
}
