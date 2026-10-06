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

import { randomUUID } from 'node:crypto'
import { updateSettings } from '@mobi/node-core/persistence'

/**
 * 本机 machineId（settings 持久化 UUID，首次生成）。唯一消费方 = hubServer 启动时的
 * 本机自注册（machines 表行在 401 store 退场前仍需 id）；会话进程不再注册 machine
 * （remove-machine 302 起 authAndSetupMachineIfNeeded 已删）。
 */
export async function ensureMachineId(): Promise<string> {
    const settings = await updateSettings((current) => {
        if (!current.machineId) {
            return {
                ...current,
                machineId: randomUUID()
            }
        }
        return current
    })

    if (!settings.machineId) {
        throw new Error('Failed to initialize machineId')
    }

    return settings.machineId
}
