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
 * DiffTarget → git 查询参数的 resolver（审查重写 v2 票04）。
 *
 * turn 档（审查 v3 供数反转）已交 TurnAttributionProvider 供数（含封口归档 → 快照
 * 两树 → journal 降级链与 toolSourceOnly 判定，见 turnAttributionProvider）——本模块
 * 不再解析 turn，消除不知归档存在的平行解析；只收口 git 系档位语义（审查档位事实的
 * 唯一权威，下游只消费解析结果）：
 * - uncommitted = HEAD vs 工作区（`git diff HEAD`）
 * - unstaged    = index vs 工作区（`git diff`）
 * - staged      = HEAD vs index（`git diff --cached HEAD`）
 * - commit      = range 两 ref（本轮协议预留多 commit，单 commit 传 base=parentSha）
 *
 * rev 语义（contents/show 侧共用）：tree sha / 'HEAD' / ''（'' = index，git `:path`
 * 语法）/ null（null 仅用于 headRev = 工作区 fs）。index 没有树 ref，工作区三档
 * 靠 diffArgs 的旗标形态表达——这是 git 的固有形态，不硬造「空树 rev」假抽象。
 *
 * 非 git 目录：isGitRepository=false；git 系档位调用方按 overview.unavailableScopes
 * 拒绝。纯解析不引 UI/网络；git 判定由调用方注入（reader 的 root() 判定——与 store
 * 解耦：直接调 handler 的场景 store 可为 null 而仓库仍在）。
 */

import type { DiffTarget } from '@mobi/shared'

export type ResolvedDiffTarget = {
    isGitRepository: boolean
    /** 基线侧 rev：tree sha / 'HEAD' / ''（index） */
    baseRev: string | null
    /** 目标侧 rev：tree sha / ''（index）/ null（工作区 fs） */
    headRev: string | null
    /** 文件清单与 patch 的 git diff 参数（不含 'diff' 动词与输出格式旗标） */
    diffArgs: string[]
}

export async function resolveDiffTarget(
    target: DiffTarget,
    deps: { isGitRepository: boolean },
): Promise<ResolvedDiffTarget> {
    // turn 档由 TurnAttributionProvider 供数（审查 v3 供数反转，降级链含封口归档）
    if (target.kind === 'turn') throw new Error('turn target is served by TurnAttributionProvider')
    if (!deps.isGitRepository) {
        return { isGitRepository: false, baseRev: null, headRev: null, diffArgs: [] }
    }

    switch (target.kind) {
        case 'worktree':
            switch (target.area) {
                case 'uncommitted':
                    return { isGitRepository: true, baseRev: 'HEAD', headRev: null, diffArgs: ['HEAD'] }
                case 'unstaged':
                    return { isGitRepository: true, baseRev: '', headRev: null, diffArgs: [] }
                case 'staged':
                    return { isGitRepository: true, baseRev: 'HEAD', headRev: '', diffArgs: ['--cached', 'HEAD'] }
            }
            break
        case 'commit':
            return {
                isGitRepository: true,
                baseRev: target.range.base,
                headRev: target.range.head,
                diffArgs: [target.range.base, target.range.head],
            }
    }
}
