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

import { renameSync, chmodSync, copyFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'

/**
 * 检测二进制是否通过安装脚本安装（位于 ~/.local/bin/）
 */
export function isInstalledViaInstallScript(binaryPath: string): boolean {
    const normalized = binaryPath.replace(/\\/g, '/')
    const expectedDir = `${homedir()}/.local/bin`
    const normalizedDir = dirname(normalized)

    return normalizedDir === expectedDir || normalizedDir === expectedDir.replace(homedir(), '~')
}

/**
 * 原子替换当前二进制文件
 * POSIX: rename() 原子操作
 * Windows: 先备份旧文件，写入新文件，延迟清理备份
 */
export function replaceBinary(newBinaryPath: string, targetPath: string): void {
    // 确保新二进制可执行
    chmodSync(newBinaryPath, 0o755)

    if (process.platform === 'win32') {
        replaceBinaryWindows(newBinaryPath, targetPath)
    } else {
        replaceBinaryPosix(newBinaryPath, targetPath)
    }
}

function replaceBinaryPosix(newBinaryPath: string, targetPath: string): void {
    // POSIX: rename 是原子操作，运行中进程不受影响（inode 语义）
    renameSync(newBinaryPath, targetPath)
}

function replaceBinaryWindows(newBinaryPath: string, targetPath: string): void {
    // Windows 上运行中进程锁住 exe，无法 rename
    // 直接 copyFile 覆盖（写入已映射文件的镜像，下次启动生效）
    try {
        copyFileSync(newBinaryPath, targetPath)
        chmodSync(targetPath, 0o755)
    } catch {
        // copyFile 也失败（罕见），尝试备份+替换
        const backupPath = targetPath + '.bak'
        if (existsSync(backupPath)) {
            try { unlinkSync(backupPath) } catch { /* ignore */ }
        }

        try {
            renameSync(targetPath, backupPath)
        } catch {
            throw new Error(
                'Cannot replace the running binary. ' +
                'Please stop all mobi processes and run `mobi upgrade` again.'
            )
        }

        try {
            copyFileSync(newBinaryPath, targetPath)
            chmodSync(targetPath, 0o755)
        } catch (error) {
            // 恢复备份
            try {
                if (existsSync(backupPath)) {
                    renameSync(backupPath, targetPath)
                }
            } catch { /* ignore */ }
            throw error
        }

        // 延迟清理备份
        setTimeout(() => {
            try { unlinkSync(backupPath) } catch { /* ignore */ }
        }, 10_000)
    }

    // 清理下载的临时文件
    try { unlinkSync(newBinaryPath) } catch { /* ignore */ }
}
