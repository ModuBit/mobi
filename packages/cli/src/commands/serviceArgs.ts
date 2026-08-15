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

/** 解析 --host/--port（支持 `--host x` 与 `--host=x` 两种形式；非法端口直接抛错） */
export function parseHostPortArgs(args: string[]): { host?: string; port?: number } {
    let host: string | undefined
    let port: number | undefined
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--host' && i + 1 < args.length) {
            host = args[++i]
        } else if (args[i] === '--port' && i + 1 < args.length) {
            port = parsePort(args[++i])
        } else if (args[i].startsWith('--host=')) {
            host = args[i].slice('--host='.length)
        } else if (args[i].startsWith('--port=')) {
            port = parsePort(args[i].slice('--port='.length))
        }
    }
    return { host, port }
}

/** 端口校验：NaN 或越界均视为非法 */
function parsePort(raw: string): number {
    const port = parseInt(raw, 10)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${raw}. Must be a number between 1 and 65535`)
    }
    return port
}
