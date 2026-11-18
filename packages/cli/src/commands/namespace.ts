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
 * CLI 侧 namespace 解析：从 CLI token 的 `base:namespace` 形状取出，与 daemon 的
 * accessToken 解析同源。fork 与 sessions 的只读会话查询共用。
 *
 * token 优先级链收口在 tokenInit.resolveEffectiveCliToken（单一来源，不再手抄
 * 镜像）；回落 default 必须在 stderr 留一行警告——鉴权/配置问题此前静默呈现为
 * 「没有可 fork 的会话」，用户无从定位真实原因（发现 E）。
 */

import chalk from 'chalk'
import { DEFAULT_NAMESPACE, parseAccessToken } from '@mobi/daemon/utils/accessToken'
import { resolveEffectiveCliToken } from '@/ui/tokenInit'

export async function resolveCliNamespace(): Promise<string> {
    try {
        const resolved = await resolveEffectiveCliToken()
        const namespace = resolved ? (parseAccessToken(resolved.token)?.namespace ?? null) : null
        if (namespace) return namespace
        console.error(
            chalk.yellow('CLI namespace 回落 default：CLI_API_TOKEN 未配置，或无法解析出 namespace（base:namespace 形状）')
        )
    } catch (error) {
        console.error(
            chalk.yellow(`CLI namespace 回落 default：读取 CLI 配置失败（${error instanceof Error ? error.message : String(error)}）`)
        )
    }
    return DEFAULT_NAMESPACE
}
