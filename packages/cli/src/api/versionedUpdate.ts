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

export type AckResult = 'success' | 'version-mismatch'

export type VersionedAckResult<ValueKey extends string> =
    | ({ result: 'success'; version: number } & Record<ValueKey, unknown | null>)
    | ({ result: 'version-mismatch'; version: number } & Record<ValueKey, unknown | null>)
    | { result: 'error'; reason?: string }

export type VersionedAckOptions<TValue, ValueKey extends string> = {
    valueKey: ValueKey
    parseValue: (value: unknown) => TValue | null
    applyValue: (value: TValue | null) => void
    applyVersion: (version: number) => void
    logInvalidValue: (context: AckResult, version: number) => void
    invalidResponseMessage: string
    errorMessage: string
    versionMismatchMessage: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null
}

export const applyVersionedAck = <TValue, ValueKey extends string>(
    ack: unknown,
    options: VersionedAckOptions<TValue, ValueKey>
): void => {
    if (!isRecord(ack)) {
        throw new Error(options.invalidResponseMessage)
    }

    const result = ack.result
    if (result === 'success' || result === 'version-mismatch') {
        const version = ack.version
        if (typeof version !== 'number') {
            throw new Error(options.invalidResponseMessage)
        }

        const rawValue = ack[options.valueKey]
        if (rawValue == null) {
            options.applyValue(null)
        } else {
            const parsed = options.parseValue(rawValue)
            if (parsed === null) {
                options.logInvalidValue(result, version)
            } else {
                options.applyValue(parsed)
            }
        }

        options.applyVersion(version)

        if (result === 'version-mismatch') {
            throw new Error(options.versionMismatchMessage)
        }

        return
    }

    if (result === 'error') {
        const reason = typeof ack.reason === 'string' ? ack.reason : 'unknown'
        throw new Error(`${options.errorMessage} (${reason})`)
    }

    throw new Error(options.invalidResponseMessage)
}
