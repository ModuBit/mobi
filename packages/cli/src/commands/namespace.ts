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
 * CLI 侧 namespace 解析：从 CLI token 的 `base:namespace` 形状取出,
 * 与 daemon 的 accessToken 解析同源；缺失/解析失败回落 default。
 *
 * fork 与 sessions 的只读会话查询共用，避免两处各写一份回落规则。
 */

import { configuration } from '@mobi/node-core/configuration'
import { readSettings } from '@mobi/node-core/persistence'
import { parseAccessToken } from '@mobi/daemon/utils/accessToken'

/**
 * 有效 token 与 initializeToken 同一优先级：env（configuration.cliApiToken 初值）
 * 优先于 settings.cli.json；否则 env 覆盖 token 时这里会查错 namespace。
 */
export async function resolveCliNamespace(): Promise<string> {
    try {
        const settings = await readSettings()
        const token = configuration.cliApiToken || settings.cliApiToken || ''
        return parseAccessToken(token)?.namespace ?? 'default'
    } catch {
        return 'default'
    }
}
