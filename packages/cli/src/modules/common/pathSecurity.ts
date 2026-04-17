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

import { resolve, sep } from 'path';

export interface PathValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validates that a path is within the allowed working directory
 * @param targetPath - The path to validate (can be relative or absolute)
 * @param workingDirectory - The session's working directory (must be absolute)
 * @returns Validation result
 */
export function validatePath(targetPath: string, workingDirectory: string): PathValidationResult {
    // Resolve both paths to absolute paths to handle path traversal attempts
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const resolvedWorkingDir = resolve(workingDirectory);

    // Check if the resolved target path starts with the working directory
    // This prevents access to files outside the working directory
    const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget
    const normalizedWorkingDir = process.platform === 'win32' ? resolvedWorkingDir.toLowerCase() : resolvedWorkingDir
    const workingDirPrefix = normalizedWorkingDir.endsWith(sep) ? normalizedWorkingDir : normalizedWorkingDir + sep

    if (normalizedTarget !== normalizedWorkingDir && !normalizedTarget.startsWith(workingDirPrefix)) {
        return {
            valid: false,
            error: `Access denied: Path '${targetPath}' is outside the working directory`
        };
    }

    return { valid: true };
}

/**
 * 校验路径是否在 homeDir 范围内
 * @param targetPath 目标路径（绝对路径）
 * @param homeDir 用户 home 目录（绝对路径）
 */
export function validateHomeDirPath(targetPath: string, homeDir: string): PathValidationResult {
    if (!homeDir) {
        return { valid: false, error: 'Home directory not configured' }
    }

    const resolvedTarget = resolve(targetPath)
    const resolvedHome = resolve(homeDir)

    const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget
    const normalizedHome = process.platform === 'win32' ? resolvedHome.toLowerCase() : resolvedHome
    const homePrefix = normalizedHome.endsWith(sep) ? normalizedHome : normalizedHome + sep

    if (normalizedTarget !== normalizedHome && !normalizedTarget.startsWith(homePrefix)) {
        return { valid: false, error: `Access denied: Path '${targetPath}' is outside the home directory` }
    }

    return { valid: true }
}
