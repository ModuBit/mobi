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

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { CHECKSUMS_FILENAME, PLATFORM_BINARY_NAME } from './constants'
import type { GitHubReleaseAsset } from './checker'

export { type GitHubReleaseAsset }

/**
 * 从 checksums.txt 内容中查找指定文件的 SHA256
 */
export function parseChecksum(checksumsContent: string, assetName: string): string | null {
    for (const line of checksumsContent.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split(/\s+/)
        if (parts.length >= 2 && parts[1] === assetName) {
            return parts[0]
        }
    }
    return null
}

/**
 * 校验文件的 SHA256 是否匹配 checksums.txt
 */
export function verifyChecksum(filePath: string, assetName: string, checksumsContent: string): boolean {
    const expectedHash = parseChecksum(checksumsContent, assetName)
    if (!expectedHash) return false

    const fileContent = readFileSync(filePath)
    const actualHash = createHash('sha256').update(fileContent).digest('hex')
    return actualHash === expectedHash
}

/**
 * 从 release assets 中查找并下载 checksums.txt
 */
export async function downloadChecksums(assets: GitHubReleaseAsset[]): Promise<string> {
    const checksumsAsset = assets.find(a => a.name === CHECKSUMS_FILENAME)
    if (!checksumsAsset) {
        throw new Error(`No ${CHECKSUMS_FILENAME} found in release assets`)
    }

    const response = await fetch(checksumsAsset.browser_download_url, {
        signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
        throw new Error(`Failed to download checksums: ${response.status}`)
    }

    return await response.text()
}

/**
 * 下载二进制文件到临时目录
 */
export async function downloadBinary(asset: GitHubReleaseAsset, destDir?: string): Promise<string> {
    const targetDir = destDir ?? tmpdir()
    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
    }

    const destPath = join(targetDir, asset.name)

    const response = await fetch(asset.browser_download_url, {
        signal: AbortSignal.timeout(300_000),
    })

    if (!response.ok) {
        throw new Error(`Failed to download ${asset.name}: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    writeFileSync(destPath, Buffer.from(buffer))

    return destPath
}

/**
 * 从 zip 归档中解压二进制文件，返回解压后的二进制路径
 */
export function extractBinaryFromZip(zipPath: string): string {
    const extractDir = join(dirname(zipPath), 'extracted')
    if (existsSync(extractDir)) {
        rmSync(extractDir, { recursive: true, force: true })
    }
    mkdirSync(extractDir, { recursive: true })

    if (process.platform === 'win32') {
        // Windows: 使用 PowerShell Expand-Archive
        execFileSync('powershell', [
            '-command',
            `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
        ], { stdio: 'pipe' })
    } else {
        // POSIX: 使用 unzip
        execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { stdio: 'pipe' })
    }

    const binaryPath = join(extractDir, PLATFORM_BINARY_NAME)
    if (!existsSync(binaryPath)) {
        throw new Error(`Binary not found in archive: ${PLATFORM_BINARY_NAME}`)
    }

    return binaryPath
}
