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
 * 五档语义收口在这一处（审查档位事实的唯一权威，下游只消费解析结果）：
 * - turn      = 快照链两树（turnIndex 缺省 = 链尾；越界/链不足抛错，handler 转 rpcError）
 * - commit    = range 两 ref（本轮协议预留多 commit，单 commit 传 base=parentSha）
 * - uncommitted = HEAD vs 工作区（`git diff HEAD`）
 * - unstaged    = index vs 工作区（`git diff`）
 * - staged      = HEAD vs index（`git diff --cached HEAD`）
 *
 * rev 语义（contents/show 侧共用）：tree sha / 'HEAD' / ''（'' = index，git `:path`
 * 语法）/ null（null 仅用于 headRev = 工作区 fs）。index 没有树 ref，工作区三档
 * 靠 diffArgs 的旗标形态表达——这是 git 的固有形态，不硬造「空树 rev」假抽象。
 *
 * 非 git 目录：isGitRepository=false；turn 档由工具层 journal 全权供数
 * （toolSourceOnly），git 系档位调用方按 overview.unavailableScopes 拒绝。
 * 纯解析不引 UI/网络；git 判定由调用方注入（reader 的 root() 判定——与 store
 * 解耦：直接调 handler 的场景 store 可为 null 而仓库仍在），快照链查询走 store
 * 接口（测试用内存 fake）。
 */

import type { DiffTarget } from '@mobi/shared'
import type { TurnSnapshotStore } from './turnSnapshotStore'

export type ResolvedDiffTarget = {
    isGitRepository: boolean
    /** 非 git 目录的 turn 档：patch/contents 全部来自工具层 journal */
    toolSourceOnly: boolean
    /** 基线侧 rev：tree sha / 'HEAD' / ''（index） */
    baseRev: string | null
    /** 目标侧 rev：tree sha / ''（index）/ null（工作区 fs） */
    headRev: string | null
    /** 文件清单与 patch 的 git diff 参数（不含 'diff' 动词与输出格式旗标） */
    diffArgs: string[]
}

export async function resolveDiffTarget(
    sessionId: string,
    target: DiffTarget,
    deps: { isGitRepository: boolean; snapshotStore: TurnSnapshotStore | null },
): Promise<ResolvedDiffTarget> {
    if (!deps.isGitRepository) {
        return {
            isGitRepository: false,
            toolSourceOnly: target.kind === 'turn',
            baseRev: null,
            headRev: null,
            diffArgs: [],
        }
    }
    const snapshotStore = deps.snapshotStore

    switch (target.kind) {
        case 'turn': {
            // 链空是常态路径而非异常（会话始于非 git 期、一键 init 后首查）：降级 journal
            // 供数（与 overview 的 turn 统计同语义，彼处链空也是 journal 补入兜底）；
            // store 不可用（极端）同此兜底。带 turnIndex 越界仍抛错——明确请求了不存在
            // 的历史轮次，journal 只有当前状态，兜底会给错数据
            if (!snapshotStore) {
                return { isGitRepository: true, toolSourceOnly: true, baseRev: null, headRev: null, diffArgs: [] }
            }
            const pair = target.turnIndex !== undefined
                ? await chainPairAt(snapshotStore, sessionId, target.turnIndex)
                : await tailPair(snapshotStore, sessionId)
            if (!pair) {
                if (target.turnIndex !== undefined) throw new Error(`turn snapshot not found (turnIndex: ${target.turnIndex})`)
                return { isGitRepository: true, toolSourceOnly: true, baseRev: null, headRev: null, diffArgs: [] }
            }
            return {
                isGitRepository: true,
                toolSourceOnly: false,
                baseRev: pair.base.tree,
                headRev: pair.head.tree,
                diffArgs: [pair.base.tree, pair.head.tree],
            }
        }
        case 'worktree':
            switch (target.area) {
                case 'uncommitted':
                    return { isGitRepository: true, toolSourceOnly: false, baseRev: 'HEAD', headRev: null, diffArgs: ['HEAD'] }
                case 'unstaged':
                    return { isGitRepository: true, toolSourceOnly: false, baseRev: '', headRev: null, diffArgs: [] }
                case 'staged':
                    return { isGitRepository: true, toolSourceOnly: false, baseRev: 'HEAD', headRev: '', diffArgs: ['--cached', 'HEAD'] }
            }
            break
        case 'commit':
            return {
                isGitRepository: true,
                toolSourceOnly: false,
                baseRev: target.range.base,
                headRev: target.range.head,
                diffArgs: [target.range.base, target.range.head],
            }
    }
}

/** 链上 turnIndex 处的一对快照（turnIndex 的基线 = 链上前一颗）；越界/链不足返回 null */
async function chainPairAt(store: TurnSnapshotStore, sessionId: string, turnIndex: number): Promise<{ base: { tree: string }; head: { tree: string } } | null> {
    const chain = await store.listChain(sessionId)
    const idx = chain.findIndex((r) => r.index === turnIndex)
    if (idx < 1) return null
    const base = chain[idx - 1]!
    const head = chain[idx]!
    return { base: { tree: base.tree }, head: { tree: head.tree } }
}

/** 链尾一对（「上一轮」缺省语义）；链不足两颗（无 baseline/无链）返回 null */
async function tailPair(store: TurnSnapshotStore, sessionId: string): Promise<{ base: { tree: string }; head: { tree: string } } | null> {
    const last = await store.lastTurnDiff(sessionId)
    if (!last) return null
    return { base: { tree: last.base.tree }, head: { tree: last.head.tree } }
}
