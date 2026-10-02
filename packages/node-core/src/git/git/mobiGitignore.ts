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
 * .mobi/.gitignore 维护（mobi 自写自管状态目录的排除面，单源）。
 *
 * `.mobi/` 是 mobi 的工作区状态目录（uploads / artifacts / turn-diffs 同居），排除
 * 条目由 mobi 自己写进 `.mobi/.gitignore`——只碰这一个文件，不碰用户仓库根 .gitignore。
 * 缺失条目末尾追加、已含不重写；文件不存在则新建。写入触发点：uploads 目录就绪
 * （历史触发点）与 turn 全文封口（turn-diffs 产生点，turnFulltextStore）。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logger } from '@/ui/logger'

/** 默认排除条目（单源：新增 mobi 状态子目录时在此补一条） */
export const MOBI_GITIGNORE_ENTRIES = ['uploads/', 'artifacts/', 'turn-diffs/']

/** 已确保过的工作区（进程内缓存：条目只增不减，目录一旦就绪永久有效，同 uploads 缓存口径） */
const ensuredWorkspaces = new Set<string>()

/**
 * 确保 `.mobi/.gitignore` 存在且包含全部默认条目。尽力而为吞错——gitignore 缺失
 * 不该阻塞主流程（未排除的代价只是 git status 多几行）。
 */
export async function ensureMobiGitignore(workspaceRoot: string): Promise<void> {
    if (ensuredWorkspaces.has(workspaceRoot)) return
    try {
        const mobiDir = join(workspaceRoot, '.mobi')
        const gitignorePath = join(mobiDir, '.gitignore')
        if (!existsSync(gitignorePath)) {
            await mkdir(mobiDir, { recursive: true })
            await writeFile(gitignorePath, MOBI_GITIGNORE_ENTRIES.join('\n') + '\n', 'utf-8')
        } else {
            // 已有内容只补缺失条目（不重排用户/mobi 既有行）
            const content = await readFile(gitignorePath, 'utf-8')
            const lines = content.split('\n')
            const missing = MOBI_GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry))
            if (missing.length > 0) {
                const appended = content.endsWith('\n')
                    ? content + missing.join('\n') + '\n'
                    : content + '\n' + missing.join('\n') + '\n'
                await writeFile(gitignorePath, appended, 'utf-8')
            }
        }
        ensuredWorkspaces.add(workspaceRoot)
    } catch (e) {
        logger.debug('[MobiGitignore] ensure failed (best effort)', workspaceRoot, e)
    }
}
