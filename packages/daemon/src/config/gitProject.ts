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
 * 会话目录 → git 项目名（agent-memory omp 配方落地）。
 *
 * 用途：mobi 生成的 per-project 管理配置里 `recallOptions.tags` 须写**展开后的**
 * `project:<name>`——vendored hook 的 recallOptions 是静态透传（applyTemplate 只覆盖
 * bankIdTemplate / retainTags / retainMetadata / retainContext），占位符不展开。
 *
 * 一致性红线：本函数必须与 hook 侧 retainTags 的 `{gitProject}` 展开算法一致
 * （claude-hook.js gitProjectName / probeOnce / commonDirOf），否则 recall tag 与
 * retain tag 错位，any 匹配下本项目专属记忆会被错误隔离。核心路径复刻：
 * - `.git` 目录 → commondir 指针（worktree 归主仓共享 .git）
 * - `.git` 文件（worktree 指针）→ `gitdir:` 目标 → commondir
 * - commonDir 以 `.git` 结尾 → 主仓根目录名；向上遍历父目录
 * - 非 git 目录 → 目录 basename（对齐 hook 的 dirName fallback）
 * 裸仓（bare）与探测重试不覆盖：daemon 会话目录不是裸仓，探测失败即回退 basename。
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

type EntryKind = 'dir' | 'file' | null

/** 路径类型探测（stat 包装：不存在 / 不可达 → null） */
async function entryKind(path: string): Promise<EntryKind> {
    try {
        const s = await stat(path)
        return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null
    } catch {
        return null
    }
}

/** .git 目录的 commondir 解析：指针（相对则相对 gitDir）→ 主仓共享 .git；无指针则自身 */
async function commonDirOf(gitDir: string): Promise<string> {
    try {
        const pointer = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim()
        if (pointer) return isAbsolute(pointer) ? pointer : resolve(gitDir, pointer)
    } catch {
        // 无 commondir 文件（普通仓）——gitDir 即 commonDir
    }
    return gitDir
}

/** worktree `.git` 文件内容 → `gitdir:` 指针目标（相对则相对持有目录） */
function gitDirFromPointer(text: string, holder: string): string | null {
    const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(text)
    if (!match) return null
    const target = match[1]
    return isAbsolute(target) ? target : resolve(holder, target)
}

/**
 * commonDir → 主仓根目录名。普通仓与 worktree 主仓的 commonDir 均以 `.git` 结尾
 * （root = 其上级）；不以 `.git` 结尾的形状（worktree 间共享目录等）取 commonDir 自身。
 */
function projectRootName(commonDir: string): string {
    return basename(commonDir) === '.git' ? basename(dirname(commonDir)) : basename(commonDir)
}

/** 会话目录 → git 项目名（向上找 .git，非 git 目录回退目录 basename） */
export async function resolveGitProjectName(directory: string): Promise<string> {
    let current = resolve(directory)
    for (;;) {
        const dotGit = join(current, '.git')
        const kind = await entryKind(dotGit)
        if (kind === 'dir') {
            return projectRootName(await commonDirOf(dotGit))
        }
        if (kind === 'file') {
            const text = await readFile(dotGit, 'utf-8').catch(() => null)
            const gitDir = text ? gitDirFromPointer(text, current) : null
            if (gitDir) {
                return projectRootName(await commonDirOf(gitDir))
            }
        }
        const parent = dirname(current)
        if (parent === current) {
            return basename(directory) || 'unknown'
        }
        current = parent
    }
}
