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
 * `mobi` 无参与 `--help` 的默认帮助文本（tui-fork 票 03）。
 *
 * 收敛后 CLI 不再隐式创建会话：托管会话从 Web 创建，终端侧只负责
 * `mobi fork` 接续与 daemon 运维。`mobi claude` 是 daemon spawn 的内部入口，
 * 刻意不出现在帮助里。
 */
export const DEFAULT_HELP_TEXT = `mobi - Claude Code on the go

Usage:
  mobi fork [id|title]     Fork a hosted session into a local Claude TUI
  mobi sessions list       List hosted sessions
  mobi daemon <action>     Manage the single-process daemon
  mobi service <action>    Manage the mobi service
  mobi setup               Interactive setup wizard
  mobi auth <action>       Manage authentication
  mobi mcp                 Start MCP stdio bridge
  mobi logs                Show daemon logs
  mobi doctor              System diagnostics & troubleshooting
  mobi version             Show version info
  mobi upgrade             Upgrade to latest version

Hosted sessions are created from the Web UI, then continued in the terminal
with \`mobi fork\`. Run \`mobi daemon start\` if the daemon is not running.
`
