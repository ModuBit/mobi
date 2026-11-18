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
 * 协议版本提示（tui-fork 票 07）。
 *
 * daemon 在 CLI 路由的响应头里带 `X-Mobi-Protocol-Version`；错误路径上
 * `extractErrorInfo` 会把它解出来。版本不一致时给一句明确的升级指引——
 * 尤其是旧 CLI 连新 daemon：v2 删除了模式互切协议面，旧客户端继续跑会
 * 静默失效，提示必须显式。
 */
export function formatProtocolVersionHint(
    serverProtocolVersion: number | undefined,
    cliProtocolVersion: number,
): string | null {
    if (serverProtocolVersion === undefined || serverProtocolVersion === cliProtocolVersion) {
        return null
    }
    if (serverProtocolVersion < cliProtocolVersion) {
        return `  Hint: daemon protocol version (${serverProtocolVersion}) is behind CLI (${cliProtocolVersion}). Please update the daemon.`
    }
    return `  Hint: CLI protocol version (${cliProtocolVersion}) is behind daemon (${serverProtocolVersion}). Please update the CLI.`
}
