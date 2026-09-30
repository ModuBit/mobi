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
 * 路径安全闸单源（源决定闸）：「工作区文件系统路径」与「仓库相对路径」两族闸门
 * 集中一处，供数器（turnAttributionProvider）与落盘侧（turnFulltextStore 的模型
 * 输出路径硬闸）共用，勿复制。
 */

import { isAbsolute, join, resolve, sep } from 'node:path'

/** 仓库相对路径安全闸门：拒绝绝对路径、反斜杠与 `..` 逃逸（git 子系统自带同规则，盘上读取同闸门） */
function isSafeRepoRelative(path: string): boolean {
    if (path === '' || path.startsWith('/') || path.includes('\\')) return false
    return path.split('/').every((seg) => seg !== '..')
}

/** 工作区文件系统路径闸：path 是工具输入的文件系统路径（E2E 实证为绝对路径；相对时以
 *  cwd 为基准），只要求解析后不逃出 cwd */
export function isSafeWorkspacePath(path: string, cwd: string): boolean {
    if (path === '' || path.includes('\0') || path.includes('\\')) return false
    const abs = resolve(isAbsolute(path) ? path : join(cwd, path))
    return abs === cwd || abs.startsWith(cwd + sep)
}

/** 路径闸按供数源分流：'workspace' = 归档供数档，path 是工具输入的文件系统路径
 *  （工作区闸）；'git' = git 档，path 是仓库相对路径（repo 相对闸；repoRoot 给出时
 *  校验解析后落在仓库内——盘上读取同基准）。失败抛 Invalid path，wire 契约（错误
 *  文案与触发时机）不变 */
export function gatePathForSource(source: 'git' | 'workspace', path: string, cwd: string, repoRoot: string | null): void {
    if (source === 'workspace') {
        if (!isSafeWorkspacePath(path, cwd)) throw new Error(`Invalid path: ${path}`)
        return
    }
    if (!isSafeRepoRelative(path)) throw new Error(`Invalid path: ${path}`)
    // 防御闭环（正常输入不可达）：闸已拒绝绝对路径与 `..` 段，解析必在 repoRoot 内
    if (repoRoot !== null) {
        const abs = resolve(repoRoot, path)
        if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) throw new Error(`Invalid path: ${path}`)
    }
}
