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
 * Web API Token 管理
 *
 * Web 浏览器登录专用密钥，与 CLI 的 cliApiToken 完全独立。
 * 优先级：环境变量 WEB_API_TOKEN > settings.hub.json > 自动生成
 */

import { generateSecureToken } from '../utils/crypto'
import { getOrCreateSettingsValue } from './generators'
import { getSettingsFile, updateSettingsFile } from './settings'

export interface WebApiTokenResult {
    token: string
    source: 'env' | 'file' | 'generated'
    isNew: boolean
    filePath: string
}

/**
 * 获取或创建 Web API token
 *
 * 优先级：
 * 1. WEB_API_TOKEN 环境变量（最高）
 * 2. settings.hub.json 的 webApiToken 字段
 * 3. 自动生成并保存到 settings.hub.json
 */
export async function getOrCreateWebApiToken(dataDir: string): Promise<WebApiTokenResult> {
    const settingsFile = getSettingsFile(dataDir)

    // 1. 环境变量优先级最高
    const envToken = process.env.WEB_API_TOKEN
    if (envToken) {
        // 持久化到文件（若尚未保存），避免环境变量丢失导致 token 失踪
        await updateSettingsFile(settingsFile, (settings) => {
            if (settings.webApiToken) return settings
            return { ...settings, webApiToken: envToken }
        })
        return { token: envToken, source: 'env', isNew: false, filePath: settingsFile }
    }

    // 2/3. 文件读取或自动生成
    const result = await getOrCreateSettingsValue({
        settingsFile,
        readValue: (settings) => settings.webApiToken ? { value: settings.webApiToken } : null,
        writeValue: (settings, value) => { settings.webApiToken = value },
        generate: generateSecureToken
    })

    return {
        token: result.value,
        source: result.created ? 'generated' : 'file',
        isNew: result.created,
        filePath: settingsFile
    }
}

/**
 * 轮换 Web API token：强制生成新值并覆盖持久化
 *
 * 供 CLI 经 HTTP API（POST /cli/web-token）远程调用——webApiToken 归 hub 所有，
 * 远程部署下 CLI 无法直接写 hub 的 settings.hub.json。
 * 调用方（路由）负责同步热更新 configuration 单例。
 * 注意：若 hub 以 WEB_API_TOKEN 环境变量启动，重启后 env 值仍会覆盖本次轮换。
 */
export async function rotateWebApiToken(dataDir: string): Promise<WebApiTokenResult> {
    const settingsFile = getSettingsFile(dataDir)
    const token = generateSecureToken()
    await updateSettingsFile(settingsFile, (settings) => ({ ...settings, webApiToken: token }))
    return { token, source: 'generated', isNew: true, filePath: settingsFile }
}
