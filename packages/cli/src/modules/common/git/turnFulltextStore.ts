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
 * turn 全文目录存储（turn-archive hydration）：封口时把归并后的 before/after 全文
 * 镜像工作区相对路径写入 `.mobi/turn-diffs/<sid>/<turnId>/{a,b}/`，并用**单次**
 * `git diff --no-index a/ b/` 目录模式合成整轮 per-file patch（对比 B 方案的逐文件
 * mkdtemp：git spawn 从 per-file 降为 per-turn，临时目录读写全省）。
 *
 * 目录布局即协议：before/after 缺侧 = 目录缺文件（/dev/null 语义），审查读侧按归档
 * ref 回读全文（oversized 兜底 / contents 历史轮供数）。`a`/`b` 子目录命名与
 * contentsPatch 的剥前缀四 token 归位约定同源——头部 `a<dir>/a/…` 形态无需适配。
 *
 * 路径安全：`file_path` 来自模型输出，镜像相对路径前先 resolve 校验不逃出工作区
 * （`../../` 穿越与工作区外绝对路径一律跳过，调用方对该文件兜底合成 patch、无 ref）。
 * 落盘时机 = 封口一次写（归并后 before 取首次 / after 取末次已定），不做 per-edit
 * 落盘；崩溃窗口与归档一致（孤儿 turn 目录不对账，读侧以归档为唯一事实源）。
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { OVERSIZE_DIFF_LINES } from '@mobi/shared'
import { git, sanitizeSessionId } from './gitExec'
import { ensureMobiGitignore } from './mobiGitignore'
import { logger } from '@/ui/logger'

/** git 执行注入（与 contentsPatch 的 GitExec 同源形状） */
export type GitExec = (cwd: string, args: string[]) => Promise<string>

/** turn 全文目录保留数（最新 N 个 turnId 目录；调 N 只改此处） */
export const TURN_FULLTEXT_KEEP = 1

/** session 目录保留数（`.mobi/turn-diffs/` 下最多保留的会话目录个数） */
export const TURN_SESSION_KEEP = 30

/**
 * turn 目录滚动清理：turnId（纯数字）子目录按 mtime 留最新 keep 个。调用方保证
 * 「写新 → 清旧」顺序；尽力而为吞错（治理失败不阻塞封口）。
 */
export async function pruneTurnDirs(rootDir: string, keep = TURN_FULLTEXT_KEEP): Promise<void> {
    await pruneByMtime(rootDir, keep, (name) => /^\d+$/.test(name))
}

/**
 * session 目录滚动清理：turn-diffs 根下按 mtime 留最新 keep 个目录，exclude（当前
 * 会话）永不自删。整目录删除天然涵盖 turn-archive.json 与全文目录（两者同目录同居）。
 */
export async function pruneSessionDirs(turnDiffsRoot: string, keep = TURN_SESSION_KEEP, exclude?: string): Promise<void> {
    await pruneByMtime(turnDiffsRoot, keep, () => true, exclude)
}

/** mtime 排序的通用滚动删除（归并读目录/stat 失败与单目录删除失败，全部吞错） */
async function pruneByMtime(dir: string, keep: number, filter: (name: string) => boolean, exclude?: string): Promise<void> {
    try {
        const names = (await readdir(dir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && filter(e.name) && e.name !== exclude)
            .map((e) => e.name)
        const stamped = await Promise.all(names.map(async (n) => ({ n, mtime: (await stat(join(dir, n))).mtimeMs })))
        const victims = stamped.sort((a, b) => a.mtime - b.mtime).slice(0, Math.max(0, stamped.length - keep))
        await Promise.all(victims.map(({ n }) => rm(join(dir, n), { recursive: true, force: true }).catch(() => undefined)))
    } catch (e) {
        logger.debug('[TurnFulltext] prune failed (best effort)', dir, e)
    }
}

/** 归档条目的全文指针（相对 turnId 目录；缺侧省略字段——add 无 before、delete 无 after） */
export type TurnFulltextRef = { before?: string; after?: string }

/** sealFiles 的单文件产出：ref + 目录模式合成的 patch（超行数闸降级空串 + 打标） */
export type TurnFulltextSealed = { ref?: TurnFulltextRef; patch: string; oversized: boolean }

/** sealFiles 入参的单文件内容对（ToolChangeEntry 的子集形状） */
export type TurnFulltextInput = { path: string; beforeContent: string | null; afterContent: string | null }

/** 全文目录根：工作区 `.mobi/turn-diffs/<sessionId>/`（turnId 子目录 + turn-archive.json 同居）。
 *  sessionId 与归档路径同清洗（读侧 sessionId 经 RPC 进来，字符面硬闸） */
export function getTurnFulltextRoot(workspaceRoot: string, sessionId: string): string {
    return join(workspaceRoot, '.mobi', 'turn-diffs', sanitizeSessionId(sessionId))
}

/**
 * 全文目录存储：sealFiles 封口一轮（落全文目录 + 目录模式合成 per-file patch），
 * readFulltext 按 ref 回读全文（审查读侧消费）。
 */
export class FileTurnFulltextStore {
    constructor(
        /** `.mobi/turn-diffs/<sessionId>/` 根（turnId 子目录的父目录） */
        private readonly rootDir: string,
        /** 路径镜像与逃逸判定的基准（file_path 一律先归一到工作区内相对路径） */
        private readonly workspaceRoot: string,
        private readonly gitExec: GitExec = git,
    ) {}

    /**
     * 封口一轮的全文落盘 + patch 合成。返回 path → 产出；被跳过的文件（路径逃逸 /
     * 双侧 null）不在返回值中，由调用方兜底。任一文件写失败只跳过该文件（吞错 debug），
     * 整体失败向上抛由调用方降级（归档照常封口，全文件走单文件兜底合成）。
     */
    async sealFiles(turnIndex: number, files: ReadonlyArray<TurnFulltextInput>): Promise<Map<string, TurnFulltextSealed>> {
        const result = new Map<string, TurnFulltextSealed>()
        const writable: Array<{ path: string; rel: string; before: string | null; after: string | null }> = []
        const turnDir = join(this.rootDir, String(turnIndex))

        // 排除面：turn-diffs 子树产生前先确保 .mobi/.gitignore（单源 mobiGitignore，尽力而为）
        await ensureMobiGitignore(this.workspaceRoot)

        for (const f of files) {
            if (f.beforeContent === null && f.afterContent === null) continue
            const rel = relative(this.workspaceRoot, resolve(f.path))
            // 路径逃逸（工作区外绝对路径 / ../ 穿越举）不落盘：file_path 来自模型输出，这里是硬闸
            if (rel.length === 0 || rel.startsWith('..') || resolve(this.workspaceRoot, rel) !== resolve(f.path)) {
                logger.debug('[TurnFulltext] skip path outside workspace', f.path)
                continue
            }
            try {
                if (f.beforeContent !== null) await writeSide(join(turnDir, 'a', rel), f.beforeContent)
                if (f.afterContent !== null) await writeSide(join(turnDir, 'b', rel), f.afterContent)
                writable.push({ path: f.path, rel, before: f.beforeContent, after: f.afterContent })
            } catch (e) {
                logger.debug('[TurnFulltext] write side failed, skip', f.path, e)
            }
        }
        if (writable.length === 0) return result

        // 两侧目录必须都存在：`git diff --no-index` 对不存在的路径直接 fatal（stdout 空），
        // 纯 add 轮（无任何 a 侧文件）整个 a 目录未创建会丢整轮 patch——存在但为空则
        // 正常产出 /dev/null 语义 patch，与缺侧协议一致
        await mkdir(join(turnDir, 'a'), { recursive: true })
        await mkdir(join(turnDir, 'b'), { recursive: true })

        // 单次目录模式 diff 出整轮 patch：头部形态与 contentsPatch 的四 token 归位实证一致
        // （modify: a{dir}/a/f b{dir}/b/f；add: a{dir}/b/f b{dir}/b/f；delete: a{dir}/a/f b{dir}/a/f）
        let raw: string
        try {
            raw = await this.gitExec(turnDir, ['diff', '--no-index', '--', join(turnDir, 'a'), join(turnDir, 'b')])
        } catch (e) {
            // git diff --no-index 以退出码 1 表达差异，stdout 在异常对象上
            raw = (e as { stdout?: string }).stdout ?? ''
        }
        const stripped = raw
            .replaceAll(`a${turnDir}/a/`, 'a/')
            .replaceAll(`a${turnDir}/b/`, 'a/')
            .replaceAll(`b${turnDir}/b/`, 'b/')
            .replaceAll(`b${turnDir}/a/`, 'b/')

        const sections = splitDiffSections(stripped)
        for (const w of writable) {
            const ref: TurnFulltextRef = {}
            if (w.before !== null) ref.before = join('a', w.rel)
            if (w.after !== null) ref.after = join('b', w.rel)
            const patch = sections.get(w.rel) ?? ''
            const oversized = patch.split('\n').length > OVERSIZE_DIFF_LINES
            result.set(w.path, { ref, patch: oversized ? '' : patch, oversized })
        }

        // 存储治理（写新 → 清旧）：turn 目录留最新 TURN_FULLTEXT_KEEP 个；session 目录
        // 留最新 TURN_SESSION_KEEP 个（exclude 当前会话永不自删）。尽力而为吞错
        await pruneTurnDirs(this.rootDir)
        await pruneSessionDirs(dirname(this.rootDir), TURN_SESSION_KEEP, basename(this.rootDir))
        return result
    }

    /** 读回 ref 指向的全文（审查读侧：oversized 兜底 / contents 历史轮供数）。
     *  缺侧返回 null（/dev/null 语义）；读失败同 null（事实宁可缺失不阻塞） */
    async readFulltext(turnIndex: number, ref: TurnFulltextRef): Promise<{ before: string | null; after: string | null }> {
        const read = async (p?: string): Promise<string | null> => {
            if (!p) return null
            try {
                return await readFile(join(this.rootDir, String(turnIndex), p), 'utf8')
            } catch {
                return null
            }
        }
        return { before: await read(ref.before), after: await read(ref.after) }
    }
}

/** 逐 side 写入（父目录递归建）；写失败上抛由 sealFiles 按文件跳过 */
async function writeSide(target: string, content: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
}

/**
 * 目录模式 diff 输出按 `diff --git` 头切分成 per-file 段，key = 文件在工作区内的
 * 相对路径（从 `+++ b/<path>` 提；delete 时 `+++ /dev/null`，回退 `--- a/<path>`）。
 * git 对含特殊字符路径会加引号——编辑族工具的常规路径不含，遇引号形态该文件拿不到
 * patch（空串），ref 与全文仍有效（读侧兜底合成），不做引号解析。
 */
function splitDiffSections(raw: string): Map<string, string> {
    const sections = new Map<string, string>()
    let current: string[] = []
    let currentPath: string | null = null
    const flush = () => {
        if (currentPath !== null && current.length > 0) sections.set(currentPath, current.join('\n'))
    }
    for (const line of raw.split('\n')) {
        if (line.startsWith('diff --git ')) {
            flush()
            current = [line]
            currentPath = null
            continue
        }
        if (current.length === 0) continue
        current.push(line)
        if (currentPath === null) {
            if (line.startsWith('+++ b/')) currentPath = line.slice('+++ b/'.length)
            else if (line.startsWith('+++ /dev/null') ) {
                // delete：b 侧 /dev/null，路径从 --- a/<path> 取
                const minus = current.find((l) => l.startsWith('--- a/'))
                if (minus) currentPath = minus.slice('--- a/'.length)
            }
        }
    }
    flush()
    return sections
}
