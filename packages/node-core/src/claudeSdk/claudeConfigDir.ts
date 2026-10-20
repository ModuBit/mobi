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

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude 配置目录（单一来源）。
 *
 * `CLAUDE_CONFIG_DIR` 优先，否则 `~/.claude`。session 包的 projects 路径与 settings
 * 查找、node-core 的能力签名都必须读同一处——否则签名监听的目录和 CLI 实际读取的
 * 目录会漂移，缓存失效判据形同虚设。
 */
export function resolveClaudeConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}
