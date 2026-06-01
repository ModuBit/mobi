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
    const backupPath = targetPath + '.bak'

    // 清理旧备份
    if (existsSync(backupPath)) {
        try { unlinkSync(backupPath) } catch { /* ignore */ }
    }

    // 备份当前二进制
    renameSync(targetPath, backupPath)

    try {
        // 写入新二进制
        copyFileSync(newBinaryPath, targetPath)
        chmodSync(targetPath, 0o755)

        // 清理新二进制临时文件
        try { unlinkSync(newBinaryPath) } catch { /* ignore */ }
    } catch (error) {
        // 恢复备份
        try {
            if (existsSync(backupPath)) {
                renameSync(backupPath, targetPath)
            }
        } catch { /* ignore */ }
        throw error
    }

    // 延迟清理备份文件（Windows 上运行中进程可能还需要旧文件）
    setTimeout(() => {
        try { unlinkSync(backupPath) } catch { /* ignore */ }
    }, 10_000)
}
