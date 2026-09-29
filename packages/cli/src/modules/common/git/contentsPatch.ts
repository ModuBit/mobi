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
 * 全文对 → unified patch 合成单源（turn-archive B 方案票01 自 gitReview 抽出）：
 * reporter 封口（存 patch 进归档）与审查 reader（四档之外的兜底合成）共用，勿复制。
 *
 * mkdtemp + `git diff --no-index` 目录模式：before/after 各落 a/ b/ 子目录的同名
 * 文件，输出的 a/<basename> 头正是 pierre 期望的形状。单侧 null = add/delete
 * （对端 /dev/null 语义由目录缺文件表达）。临时目录即写即清，失败吞错返回空串。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { logger } from '@/ui/logger'

/** git 执行注入（gitExec 收口 git() 同源：抛错式，--no-index 的退出码 1
 *  表达「有差异」，stdout 挂在异常对象上由本模块取回） */
export type GitExec = (cwd: string, args: string[]) => Promise<string>

export async function synthesizeContentsPatch(git: GitExec, path: string, before: string | null, after: string | null): Promise<string> {
    if (before === null && after === null) return ''
    const dir = await mkdtemp(join(tmpdir(), 'mobi-review-patch-'))
    try {
        const base = basename(path)
        const sideA = join(dir, 'a', base)
        const sideB = join(dir, 'b', base)
        await mkdir(dirname(sideA), { recursive: true })
        await mkdir(dirname(sideB), { recursive: true })
        if (before !== null) await writeFile(sideA, before)
        if (after !== null) await writeFile(sideB, after)
        let raw: string
        try {
            raw = await git(dir, ['diff', '--no-index', '--', join(dir, 'a'), join(dir, 'b')])
        } catch (e) {
            // git diff --no-index 以退出码 1 表达差异，stdout 在异常对象上
            raw = (e as { stdout?: string }).stdout ?? ''
        }
        // 头部剥临时目录前缀（git 规范化绝对路径的前导 /）。实证（git 2.x 目录模式）
        // 四形态——a/b 前缀不总对应 a/b 目录：单侧 null 时 git 把非缺侧路径指到对端
        // 目录（modify: a{TMP}/a/f b{TMP}/b/f；add: a{TMP}/b/f b{TMP}/b/f；
        // delete: a{TMP}/a/f b{TMP}/a/f），四 token 各自归位 a/<name> / b/<name>
        return raw
            .replaceAll(`a${dir}/a/`, 'a/')
            .replaceAll(`a${dir}/b/`, 'a/')
            .replaceAll(`b${dir}/b/`, 'b/')
            .replaceAll(`b${dir}/a/`, 'b/')
    } catch (e) {
        logger.debug('[ContentsPatch] synthesize patch failed', e)
        return ''
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}
