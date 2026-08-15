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
 * Supervisor 期望状态持久化。
 *
 * supervisor 是唯一写入方；崩溃/重启（含 launchd/systemd 开机拉起）后
 * 读取该文件恢复停机前的托管配置。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { configuration } from '@/configuration'

export interface SupervisorDesiredState {
    /** 是否托管 hub */
    hub: boolean
    /** 是否托管 runner */
    runner: boolean
    /** hub 监听地址 */
    host: string
    /** hub 监听端口 */
    port: number
}

export const DEFAULT_SUPERVISOR_HOST = '127.0.0.1'
export const DEFAULT_SUPERVISOR_PORT = 2222

export function defaultDesiredState(): SupervisorDesiredState {
    return {
        hub: false,
        runner: false,
        host: DEFAULT_SUPERVISOR_HOST,
        port: DEFAULT_SUPERVISOR_PORT,
    }
}

/**
 * 读取期望状态。文件缺失或整体非法 JSON 返回 null；
 * 字段级损坏则强制归一（布尔化、非法端口回落默认），保证 supervisor 永远能启动。
 */
export function readDesiredState(
    filePath: string = configuration.supervisorStateFile,
): SupervisorDesiredState | null {
    try {
        if (!existsSync(filePath)) return null
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
        if (typeof parsed !== 'object' || parsed === null) return null
        const port = Number(parsed.port)
        return {
            hub: Boolean(parsed.hub),
            runner: Boolean(parsed.runner),
            host: typeof parsed.host === 'string' && parsed.host ? parsed.host : DEFAULT_SUPERVISOR_HOST,
            port: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_SUPERVISOR_PORT,
        }
    } catch {
        return null
    }
}

export function writeDesiredState(
    state: SupervisorDesiredState,
    filePath: string = configuration.supervisorStateFile,
): void {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
}
