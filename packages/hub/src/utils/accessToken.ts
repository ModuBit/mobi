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

export const DEFAULT_NAMESPACE = 'default'

export type ParsedAccessToken = {
    baseToken: string
    namespace: string
}

export function parseAccessToken(raw: string): ParsedAccessToken | null {
    if (!raw) {
        return null
    }

    const trimmed = raw.trim()
    if (!trimmed) {
        return null
    }

    const separatorIndex = trimmed.lastIndexOf(':')
    if (separatorIndex === -1) {
        return { baseToken: trimmed, namespace: DEFAULT_NAMESPACE }
    }

    const baseToken = trimmed.slice(0, separatorIndex)
    const namespace = trimmed.slice(separatorIndex + 1)
    if (!baseToken || !namespace) {
        return null
    }

    if (baseToken.trim() !== baseToken || namespace.trim() !== namespace) {
        return null
    }

    return { baseToken, namespace }
}
