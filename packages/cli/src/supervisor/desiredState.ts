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

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
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

/**
 * 默认端口兜底：优先取当前 profile 注入的 MOBI_LISTEN_PORT（supervisor 由 CLI
 * spawn 时继承 profile env），无/非法则回落 2222。
 *
 * 背景：e2e/dev profile 端口与 default 不同（2224/2223）。desired state 为空时若
 * 硬编码 2222，`mobi hub start --profile e2e` 不带 --port 会与 default 环境 hub
 * 撞端口，且 supervisor 健康门可能打到 default hub 上假通过。
 */
function profilePortOrDefault(): number {
    const envPort = Number(process.env.MOBI_LISTEN_PORT)
    return Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : DEFAULT_SUPERVISOR_PORT
}

export function defaultDesiredState(): SupervisorDesiredState {
    return {
        hub: false,
        runner: false,
        host: DEFAULT_SUPERVISOR_HOST,
        port: profilePortOrDefault(),
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
            port:
                Number.isFinite(port) && Number.isInteger(port) && port > 0 && port < 65536
                    ? port
                    : profilePortOrDefault(),
        }
    } catch {
        return null
    }
}

/**
 * 原子写：先写临时文件再 rename，supervisor 崩溃时不会留下半截 JSON
 * （读到半截文件会被 readDesiredState 判为非法而丢失整个期望状态）。
 */
export function writeDesiredState(
    state: SupervisorDesiredState,
    filePath: string = configuration.supervisorStateFile,
): void {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmpPath = `${filePath}.tmp`
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmpPath, filePath)
}
