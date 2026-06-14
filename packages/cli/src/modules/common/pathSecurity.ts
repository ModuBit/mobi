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

export { validateHomeDirPath, isWithinBlacklistedDir } from '@mobi/shared/pathSecurity'
export type { PathValidationResult } from '@mobi/shared/pathSecurity'

/**
 * 校验路径是否在 workingDirectory 范围内（支持相对路径）
 */
export function validatePath(targetPath: string, workingDirectory: string): import('@mobi/shared/pathSecurity').PathValidationResult {
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const resolvedWorkingDir = resolve(workingDirectory);

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
