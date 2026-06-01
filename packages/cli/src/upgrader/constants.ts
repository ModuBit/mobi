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

/** GitHub 仓库信息 */
export const GITHUB_OWNER = 'modu'
export const GITHUB_REPO = 'mobi'
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

/** Channel 定义 */
export type Channel = 'stable' | 'rc'

export const CHANNEL_TAG_PATTERNS: Record<Channel, RegExp> = {
    stable: /^v\d+\.\d+\.\d+$/,        // v0.1.0（排除 -rc.*）
    rc: /^v\d+\.\d+\.\d+-rc\.\d+$/,    // v0.2.0-rc.1
}

/** 根据 tag 判断 channel */
export function detectChannel(tag: string): Channel | null {
    if (CHANNEL_TAG_PATTERNS.rc.test(tag)) return 'rc'
    if (CHANNEL_TAG_PATTERNS.stable.test(tag)) return 'stable'
    return null
}

/** 平台二进制名称映射 */
export const PLATFORM_BINARY_NAME = process.platform === 'win32' ? 'mobi.exe' : 'mobi'

/** 获取当前平台对应的 Release asset 名称 */
export function getPlatformAssetName(): string {
    const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'windows'
    const arch = process.arch
    return `mobi-${platform}-${arch}.zip`
}

/** 安装路径 */
export const INSTALL_DIR = process.platform === 'win32'
    ? `${process.env.USERPROFILE}\\.local\\bin`
    : `${homedir()}/.local/bin`

/** checksums 文件名 */
export const CHECKSUMS_FILENAME = 'checksums.txt'

/** 版本列表默认显示条数 */
export const VERSION_LIST_LIMIT = 10
