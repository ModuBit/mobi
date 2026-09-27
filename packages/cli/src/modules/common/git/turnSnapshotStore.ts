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
 * 轮次快照存储（ADR 0008）——本特性全唯一的测试 seam。
 *
 * 职责：按会话在工作区打 git tree 快照、读链、清链、两树 per-file diff。
 * 引用形态 `refs/mobi/turn-diffs/<sessionId>/<n>`（会话归属编码在引用路径，
 * fork/resume 天然共享链），快照动作不产生 commit、不碰分支/用户 index/工作区。
 *
 * 接口与实现分离的纪律（codebase-design）：CLI 内 git 执行只收口在 gitTurnSnapshotStore
 * 适配器；下游（轮次变更合成器、审查数据 RPC）只依赖本接口——测试用
 * createInMemoryTurnSnapshotStore 的内存 fake，不跑真 git。
 */

/** 快照引用：会话内递增序号 + git tree SHA */
export type TurnSnapshotRef = {
    /** 会话内从 1 递增的快照序号 */
    index: number
    /** git tree 对象 SHA */
    tree: string
}

export type TurnTreeDiffKind = 'add' | 'delete' | 'rename' | 'modify'

/** 两树 diff 的单文件条目（binary 时 additions/deletions 恒 0，以 binary 标记表达） */
export type TurnTreeDiffEntry = {
    /** 变更后路径（rename = 新路径；delete = 被删路径） */
    path: string
    kind: TurnTreeDiffKind
    additions: number
    deletions: number
    /** 二进制文件（git numstat 输出 `-` 计数） */
    binary: boolean
    /** rename 原路径 */
    previousPath?: string
}

/** 轮次快照存储接口——调用方唯一可见的面 */
export interface TurnSnapshotStore {
    /** 对工作区打一次快照，落引用并返回（序号 = 链尾 +1，链空则 1） */
    capture(sessionId: string): Promise<TurnSnapshotRef>
    /** 读会话快照链，按 index 升序；无链返回空数组 */
    listChain(sessionId: string): Promise<TurnSnapshotRef[]>
    /** 当前 HEAD 树——首轮快照（链空）的 diff 兜底基线；空仓库（无 commit）返回 null */
    headTree(): Promise<string | null>
    /** 两棵树之间的 per-file diff；无差异返回空数组 */
    diffTrees(baseTree: string, headTree: string): Promise<TurnTreeDiffEntry[]>
    /** 清除会话全部快照引用，返回清除数（幂等：无链返回 0） */
    clearSession(sessionId: string): Promise<number>
}

/** 简易文件快照（fake 用）：路径 → 内容行 */
type TreeFiles = Record<string, string[]>

/** fake 的树内容注册表：tree id → 文件行映射 */
export type InMemoryTrees = Record<string, TreeFiles>

/**
 * 内存 fake：下游票（合成器/审查数据）的测试桩。
 * diff 以行多重集对比近似（additions = head 有 base 无的行数），kind 支持
 * add/delete/modify——rename/binary 语义属 git 适配器，fake 不模拟。
 */
export function createInMemoryTurnSnapshotStore(options?: {
    /** 预置链：sessionId → 升序引用数组 */
    chains?: Record<string, TurnSnapshotRef[]>
    /** 预置树内容：tree id → 文件映射，供 diffTrees 计算 */
    trees?: InMemoryTrees
    /** headTree() 返回值（缺省固定值；null 模拟空仓库） */
    headTree?: string | null
}): TurnSnapshotStore & {
    /** 测试辅助：直接注册一棵树的内容（供 capture 后改写 diff 预期） */
    registerTree(tree: string, files: TreeFiles): void
} {
    const chains = new Map<string, TurnSnapshotRef[]>(
        Object.entries(options?.chains ?? {}).map(([sid, refs]) => [sid, [...refs]]),
    )
    const trees = new Map<string, TreeFiles>(Object.entries(options?.trees ?? {}))
    // null 是合法值（模拟空仓库），不能用 ?? 吞掉
    const headTree = options && 'headTree' in options ? options.headTree! : 'fake-head-tree'

    const diffFiles = (base: TreeFiles, head: TreeFiles): TurnTreeDiffEntry[] => {
        const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()
        const entries: TurnTreeDiffEntry[] = []
        for (const path of paths) {
            const before = base[path]
            const after = head[path]
            if (before && !after) entries.push({ path, kind: 'delete', additions: 0, deletions: before.length, binary: false })
            else if (!before && after) entries.push({ path, kind: 'add', additions: after.length, deletions: 0, binary: false })
            else {
                const beforeLines = new Set(before)
                const afterLines = new Set(after)
                const additions = after.filter((l) => !beforeLines.has(l)).length
                const deletions = before.filter((l) => !afterLines.has(l)).length
                if (additions > 0 || deletions > 0) {
                    entries.push({ path, kind: 'modify', additions, deletions, binary: false })
                }
            }
        }
        return entries
    }

    return {
        async capture(sessionId) {
            const chain = chains.get(sessionId) ?? []
            const ref: TurnSnapshotRef = { index: (chain.at(-1)?.index ?? 0) + 1, tree: `fake-tree-${chain.length + 1}` }
            chain.push(ref)
            chains.set(sessionId, chain)
            return ref
        },
        async listChain(sessionId) {
            return (chains.get(sessionId) ?? []).map((r) => ({ ...r }))
        },
        async headTree() {
            return headTree
        },
        async diffTrees(baseTree, headTree) {
            return diffFiles(trees.get(baseTree) ?? {}, trees.get(headTree) ?? {})
        },
        async clearSession(sessionId) {
            const removed = chains.get(sessionId)?.length ?? 0
            chains.delete(sessionId)
            return removed
        },
        registerTree(tree, files) {
            trees.set(tree, files)
        },
    }
}
