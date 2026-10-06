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
 * spawn 结果 → {@link SpawnGatewayResult} 的映射单源（ticket-18 抽出）。
 * 所有 spawn 回执路径（executor 直调回执等）共用，
 * 成功/already-running/error(+failure 分类) 归一不会分叉。
 */

import { classifyTransportFailure } from '../sync/rpcCaller'
import type { SpawnGatewayResult } from './executorHost'

export function mapSpawnResultToGateway(result: unknown): SpawnGatewayResult {
    // 文字来路的失败统一走这里：上游的人话多半归 'other'（原样透出），
    // 只有 executor 等 webhook 超时那一句会被读成 'timeout'
    const spawnError = (message: string) => ({ type: 'error' as const, message, failure: classifyTransportFailure(message) })

    if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>
        if (obj.type === 'success' && typeof obj.sessionId === 'string') {
            return { type: 'success', sessionId: obj.sessionId }
        }
        if (obj.type === 'already-running') {
            return { type: 'already-running' }
        }
        if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
            return spawnError(obj.errorMessage)
        }
        if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
            return spawnError(`Directory creation requires approval: ${obj.directory}`)
        }
        if (typeof obj.error === 'string') {
            return spawnError(obj.error)
        }
        if (obj.type !== 'success' && typeof obj.message === 'string') {
            return spawnError(obj.message)
        }
    }
    const details = typeof result === 'string'
        ? result
        : (() => {
            try {
                return JSON.stringify(result)
            } catch {
                return String(result)
            }
        })()
    return spawnError(`Unexpected spawn result: ${details}`)
}
