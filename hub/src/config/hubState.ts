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
 * Hub 状态文件管理
 * 启动时写入 hub.state.json，关闭时清理，供 CLI status/stop 子命令使用
 */

import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface HubPersistedState {
    pid: number
    listenHost: string
    listenPort: number
    startTime: string
}

function getHubStateFile(dataDir: string): string {
    return join(dataDir, 'hub.state.json')
}

/**
 * 写入 hub 状态文件（同步写入保证原子性）
 */
export function writeHubState(dataDir: string, state: HubPersistedState): void {
    const stateFile = getHubStateFile(dataDir)
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * 清理 hub 状态文件
 */
export function clearHubState(dataDir: string): void {
    const stateFile = getHubStateFile(dataDir)
    try {
        unlinkSync(stateFile)
    } catch {
        // 文件可能已不存在
    }
}
