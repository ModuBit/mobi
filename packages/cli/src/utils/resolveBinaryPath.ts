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

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { platform } from 'os'
import { runtimePath } from '@/projectPath'

/**
 * 平台标记文件名，由 unpack-tools 脚本或 ensureRuntimeAssets 写入
 */
export const UNPACKED_PLATFORM_MARKER = 'unpacked-platform'

const cache = new Map<string, string>()

/**
 * 解析工具二进制文件路径，结果在进程生命周期内缓存
 *
 * 优先使用 tools/unpacked/ 中的打包版本（通过标记文件验证平台匹配），
 * 否则回退到系统 PATH 中的同名二进制
 */
export function resolveBinaryPath(binaryName: string): string {
    const cached = cache.get(binaryName)
    if (cached !== undefined) return cached

    const isWin = platform() === 'win32'
    const name = isWin && !binaryName.endsWith('.exe') ? `${binaryName}.exe` : binaryName
    const unpackedDir = resolve(runtimePath(), 'tools', 'unpacked')
    const packedPath = join(unpackedDir, name)

    if (!existsSync(packedPath)) {
        cache.set(binaryName, name)
        return name
    }

    const hasMarker = existsSync(join(unpackedDir, UNPACKED_PLATFORM_MARKER))
    const result = hasMarker ? packedPath : name
    cache.set(binaryName, result)
    return result
}
