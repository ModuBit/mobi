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
 * untracked skill 的本地删除（不涉及 skills CLI——tracked 路径已全部收敛到
 * skillInventoryClient 的编程 API）。
 *
 * untracked 是 mobi 自管文件：symlink 行只删链接（真身归 CLI 语义或用户自管），
 * 真目录整体删除。删除前二次校验目标确为 skill 根下的直接子项（防 TOCTOU /
 * 路径注入误删；realpath 比对）。
 */
import { existsSync, lstatSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SkillInfo } from '@mobi/shared'
import { daemonLogger } from '../logger'
import type { SkillScanRoots } from './skillScanner'
import { scopeView, type SkillScope } from './skillScope'

/** untracked 路径删除结果：refused = 目标校验失败（不动文件系统） */
export type UntrackedRemoveResult = { ok: true } | { ok: false; error: string }

/**
 * untracked 路径：直接删 agent 目录条目。
 * 目标校验：行携带的 SKILL.md 路径，其父目录必须恰为 skill 根的直接子项——
 * 与扫描器发现的根一致（personal → claudeConfigDir/skills；project → <ws>/.claude/skills），
 * 不一致说明行数据与磁盘已漂移（TOCTOU），拒绝执行。
 * 目录名不要求等于 frontmatter name：CC 不强制该同形约定（dir 名与 name 可不同，
 * 扫描器照常列出且可删），realpath 比对才是防误删的真正边界。
 */
export function removeUntrackedSkill(
    skill: SkillInfo,
    roots: SkillScanRoots,
    scope: SkillScope,
): UntrackedRemoveResult {
    const expectedRoot = scopeView(roots, scope).skillRoot

    const dir = dirname(skill.path)
    // realpath 两侧再比对：防 skill 根自身是链接时的绕过
    if (!existsSync(dir) || !existsSync(expectedRoot)) {
        return { ok: false, error: `Skill directory no longer exists: ${dir}` }
    }
    if (realpathSync(dirname(dir)) !== realpathSync(expectedRoot)) {
        return { ok: false, error: `Refusing to delete outside skill root: ${dir}` }
    }

    const stat = lstatSync(dir)
    if (stat.isSymbolicLink()) {
        // symlink 行只删链接——中央仓真身归 CLI 语义（tracked）或用户自管
        unlinkSync(dir)
    } else if (stat.isDirectory()) {
        rmSync(dir, { recursive: true, force: true })
    } else {
        return { ok: false, error: `Not a skill directory: ${dir}` }
    }
    daemonLogger.info(`[skills] untracked 删除：${dir}`)
    return { ok: true }
}
