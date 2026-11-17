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
 * skills 编程 API 封装（skill 清单全链路：列出 / 安装 / 卸载 / 更新）。
 *
 * skills 是 npm 包且导出编程 API（resolveSource / listSkills / installSkills /
 * removeSkills），比 spawn CLI 强在：结构化返回（无 TUI 文本解析）、清单带
 * description、损坏 skill 扫描期自动跳过（不进清单 → 不存在「勾了坏的装一半」）、
 * 单 skill 失败落结构化 failed 数组。daemon 已无线 spawn skills CLI 的路径。
 *
 * 实测语义锚点（2026-11-17，skills@1.9.0）：
 * - global 安装 = symlink + ~/.agents 中央仓 + ~/.agents/.skill-lock.json；
 *   project 安装 = 拷贝 + <cwd>/skills-lock.json（无中央仓）
 * - listSkills 的 project 侧 sourceUrl 为 null、source（owner/repo 短名）有值；
 *   global 侧两者都有——已装判定键统一用 (source, name)
 * - 重装同名 skill 会整目录覆盖真身（cleanAndCreateDirectory，源码实锤）——
 *   跨来源同名（conflict）必须在 UI 警告
 * - API 未导出 update；CLI 的 update 本质是「读 lock 的 source → 重新 fetch +
 *   install」，故更新 = installSkills 重装（刷新 hash/commit，语义等同）
 * - resolveSource 每次都要 git clone（慢、且「获取清单→安装」会触发两次）；
 *   句柄经 createSourceCache 缓存，installSkills 直接吃 SkillSource 复用同一次克隆
 */

import { installSkills, listSkills, removeSkills, resolveSource, type SkillSource } from 'skills'
import type { SkillAvailableInfo, SkillRegistrySkill } from '@mobi/shared'

/** repo 内可选 skill（resolveSource 清单项） */
export interface RepoSkillOption {
    name: string
    description: string
}

/** 已装清单所属的层：workspace（项目）覆盖 global（同名时近层生效） */
export type SkillInstallScope = 'global' | 'workspace'

/** 已装 skill 的判定引用（listSkills 项的最小集 + 所属层） */
export interface InstalledSkillRef {
    name: string
    /** owner/repo 短名（global/project tracked 均有）；null = untracked（本地自管） */
    source: string | null
    /** 条目来自哪一层清单（listInstalledSkillRefs 按查询作用域盖章，判定不靠列表顺序） */
    scope: SkillInstallScope
}

/** installSkills 的结构化结果（按 mobi 需要收窄） */
export interface InstallSelectedResult {
    installed: string[]
    failed: Array<{ skill: string; error: string }>
}

/** 从 github url 提取 owner/repo 短名（与 listSkills 的 source 同形；非 github url 原样返回） */
export function repoShortName(url: string): string {
    // repo 名可含点（next.js、foo.bar）：只到路径分隔/结尾为止，再剥 `.git` 后缀
    const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:[/?#]|$)/)
    return m ? `${m[1]}/${m[2]}` : url
}

/** resolveSource 句柄缓存：available 阶段的克隆留给 install 复用（installSkills 直接吃
 *  SkillSource，免二次 clone）；临时目录的释放时机由缓存自己负责（TTL/上限/租约） */
export interface SourceCache {
    /**
     * 在源句柄上执行一次操作（租约语义）。
     *
     * - 同源并发共享同一次解析（clone），命中缓存则瞬时返回；
     * - fn 运行期间条目不会被 TTL 或容量淘汰释放——临时目录不会在操作中途被清掉；
     * - fn 结束（正常或抛错）只归还租约；条目留在缓存继续服务后续操作（拉清单 → 安装
     *   复用同一次克隆），临时目录由 TTL + 上限兜底回收。
     */
    withSource<T>(source: string, fn: (handle: SkillSource) => T | Promise<T>): Promise<T>
}

/**
 * 源句柄缓存工厂（单测直接覆盖；生产 = defaultSourceCache）。
 *
 * 为什么需要：resolveSource 每次都要 git clone 整个仓库（实测 anthropics/skills
 * 浅克隆 2–20s，网络差时更久），用户「获取清单 → 安装」会先后触发两次解析。
 * 缓存句柄让第二跳直接复用同一次克隆，重复拉清单也瞬时命中。
 * 临时目录是磁盘资源，靠 TTL + 上限双重兜底释放。
 */
export function createSourceCache(
    resolve: (source: string) => Promise<SkillSource>,
    options: { ttlMs?: number; maxEntries?: number } = {},
): SourceCache {
    const ttlMs = options.ttlMs ?? 10 * 60 * 1000
    const maxEntries = options.maxEntries ?? 3

    interface CacheEntry {
        handle: SkillSource
        timer: ReturnType<typeof setTimeout>
        /** 进行中的租约数：>0 期间不得释放（TTL/淘汰都延后到最后一个租约归还） */
        leases: number
        /** 已被 TTL/淘汰判死，等最后一个租约归还后真正回收 */
        disposePending: boolean
    }

    const entries = new Map<string, CacheEntry>()
    const inflight = new Map<string, Promise<CacheEntry>>()
    /**
     * 解析串行化：同时只跑一个 clone。取消获取只是「放弃等待」，旧 clone 仍会在后台收尾；
     * 若此时用户换 source 再拉，两个克隆叠加会抢网络/磁盘（个人单机场景串行足够）。
     * 同源并发仍走 inflight 去重，不排队。
     */
    let resolveQueue: Promise<unknown> = Promise.resolve()
    const serializeResolve = <T>(task: () => Promise<T>): Promise<T> => {
        const run = resolveQueue.then(task, task)
        resolveQueue = run.then(() => undefined, () => undefined)
        return run
    }

    const disposeNow = async (source: string, entry: CacheEntry): Promise<void> => {
        // 条目可能已被替换/移除：只回收自己这张票据
        if (entries.get(source) !== entry) return
        entries.delete(source)
        clearTimeout(entry.timer)
        await entry.handle.dispose().catch(() => {})
    }

    /** 请求回收：无租约立即释放；有租约只打标记，最后一个租约归还时补回收 */
    const requestDispose = (source: string, entry: CacheEntry): void => {
        if (entry.leases > 0) {
            entry.disposePending = true
            return
        }
        void disposeNow(source, entry)
    }

    /**
     * 容量上限回收：只在「未判死」的条目里腾位（已判死但被租用的条目视为已让位，
     * 避免同一次超限把所有条目一起标记）。
     */
    const evictOverflow = (): void => {
        const liveCount = (): number => {
            let count = 0
            for (const entry of entries.values()) if (!entry.disposePending) count += 1
            return count
        }
        while (liveCount() > maxEntries) {
            let victim: [string, CacheEntry] | null = null
            for (const pair of entries) {
                if (!pair[1].disposePending) { victim = pair; break }
            }
            if (!victim) return
            requestDispose(victim[0], victim[1])
        }
    }

    /** 取（或首次解析）条目并立即占用一个租约；同源并发共享同一次解析 */
    const ensureEntry = async (source: string): Promise<CacheEntry> => {
        const hit = entries.get(source)
        if (hit) {
            hit.leases += 1
            return hit
        }
        const pending = inflight.get(source)
        if (pending) {
            const entry = await pending
            entry.leases += 1
            return entry
        }
        const resolving = serializeResolve(() => resolve(source)).then((handle) => {
            // 解析完成即持租约（本调用方）；定时器回调晚于初始化，闭包引用安全
            const entry: CacheEntry = {
                handle,
                timer: setTimeout(() => { requestDispose(source, entry) }, ttlMs),
                leases: 1,
                disposePending: false,
            }
            // 不因 TTL 定时器拖住宿主进程退出
            entry.timer.unref?.()
            entries.set(source, entry)
            evictOverflow()
            return entry
        }).finally(() => {
            inflight.delete(source)
        })
        inflight.set(source, resolving)
        return resolving
    }

    const endLease = (source: string, entry: CacheEntry): void => {
        entry.leases -= 1
        if (entry.leases === 0 && entry.disposePending) void disposeNow(source, entry)
    }

    return {
        async withSource<T>(source: string, fn: (handle: SkillSource) => T | Promise<T>): Promise<T> {
            const entry = await ensureEntry(source)
            try {
                return await fn(entry.handle)
            } finally {
                endLease(source, entry)
            }
        },
    }
}

/** 生产缓存（resolveSource 直连 skills 包） */
export const defaultSourceCache = createSourceCache(source => resolveSource(source))

/** 解析 repo 可用清单（句柄留在缓存：install 复用同一次克隆；损坏 skill 已被 API 过滤） */
export async function resolveRepoSkills(source: string): Promise<{ repoSource: string; skills: RepoSkillOption[] }> {
    return defaultSourceCache.withSource(source, handle => ({
        repoSource: repoShortName(handle.source.url),
        skills: handle.skills.map(s => ({ name: s.name, description: s.description })),
    }))
}

/**
 * API options → `skills` 包调用选项（list/install/remove/reinstall 四函数共用）。
 * 形状由 skills 包定（global 布尔 + project 时的 cwd）；漏传 cwd 会把操作落进错误 scope。
 */
function toSkillsCallOptions(options: { global: boolean; cwd?: string }): { scope: 'global' | 'project'; cwd?: string } {
    return {
        scope: options.global ? 'global' : 'project',
        ...(options.cwd ? { cwd: options.cwd } : {}),
    }
}

/** 列指定 scope 的已装清单（仅 claude-code agent——安装判定面与其他 agent 无关）。
 *  返回的引用按查询作用域盖章（scope），两层同名条目各自独立存在、无损保留 */
export async function listInstalledSkillRefs(options: { global: boolean; cwd?: string }): Promise<InstalledSkillRef[]> {
    const result = await listSkills({
        agents: ['claude-code'],
        ...toSkillsCallOptions(options),
    })
    const scope: SkillInstallScope = options.global ? 'global' : 'workspace'
    return result.skills.map(s => ({ name: s.name, source: s.source ?? null, scope }))
}

/**
 * 选择性安装（skills 缺省 = repo 全装；project scope 必须带 cwd 定位）。
 * 统一走源缓存租约：已有克隆直接复用（免二次 clone），没有则由缓存解析一次；
 * 临时目录的释放归缓存（TTL/上限），安装路径不再自行决定 release 时机。
 */
export async function installSelectedSkills(
    source: string,
    skillNames: string[] | null,
    options: { global: boolean; cwd?: string },
): Promise<InstallSelectedResult> {
    return defaultSourceCache.withSource(source, async (handle) => {
        const result = await installSkills(handle, {
            agents: ['claude-code'],
            ...toSkillsCallOptions(options),
            ...(skillNames ? { skills: skillNames } : {}),
        })
        return {
            installed: result.installed.map(t => t.skill),
            failed: result.failed.map(f => ({ skill: f.skill, error: f.message })),
        }
    })
}

/** 生产 API 面（skills 包编程接口直连；测试经 SkillsDeps.api 注入 fake） */
export const defaultSkillsApiClient = {
    resolveRepoSkills,
    listInstalledSkillRefs,
    installSelectedSkills,
    removeInstalledSkill,
    reinstallSkill,
    searchRegistrySkills,
}

/** 可注入的 API 面类型：由生产实现推导，手写接口会与实现漂移 */
export type SkillsApiClient = typeof defaultSkillsApiClient

/** skills.sh 生态搜索端点基址（与 CLI find 同源；env 可覆盖镜像/测试） */
const REGISTRY_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh'

/**
 * 生态搜索 = CLI 的 `skills find`（skills.sh 注册表）。该命令只有交互式 TUI、
 * 未导出编程 API，故直连其 HTTP 端点（CLI 源码同款请求）。命中项带 source
 * （owner/repo，可直接接两步式安装）+ skillId（选择段预勾选靶）。
 * 非 2xx 明确抛错（不伪装空结果）；缺字段的脏项过滤掉。
 */
export async function searchRegistrySkills(query: string): Promise<SkillRegistrySkill[]> {
    const params = new URLSearchParams({ q: query })
    const res = await fetch(`${REGISTRY_API_BASE}/api/search?${params.toString()}`)
    if (!res.ok) throw new Error(`skills registry search failed: HTTP ${res.status}`)
    const body = await res.json() as {
        skills?: Array<{ name?: string; source?: string; skillId?: string; installs?: number }>
    }
    return (body.skills ?? [])
        .filter((s): s is { name: string; source: string; skillId: string; installs?: number } =>
            Boolean(s.name && s.source && s.skillId))
        .map(s => ({ name: s.name, source: s.source, skillId: s.skillId, installs: s.installs ?? 0 }))
}

/** 单 skill 动作结果（卸载/更新共用：ok=false 时 error 透传前端） */
export interface SkillActionResult {
    ok: boolean
    error?: string
}

/**
 * 卸载 tracked skill：removeSkills 闭环（agent 目录条目 + 共享真身 + lock 条目，
 * 真身仍被其他 agent 引用时保留——CLI 语义，mobi 不自判）。
 * removed 不含目标名（notFound / failed）即失败，错误信息逐项拼接。
 */
export async function removeInstalledSkill(
    name: string,
    options: { global: boolean; cwd?: string },
): Promise<SkillActionResult> {
    const result = await removeSkills([name], {
        agents: ['claude-code'],
        ...toSkillsCallOptions(options),
    })
    if (result.removed.includes(name)) return { ok: true }
    const failure = result.failed.find(f => f.skill === name)
    return {
        ok: false,
        error: failure?.message ?? (result.notFound.includes(name) ? `Skill not found in lock: ${name}` : 'remove failed'),
    }
}

/**
 * 更新 tracked skill（= 重装）：从行的 installSource 重新 fetch + install，
 * 刷新 lock 的 hash/commit。CLI update 的等价实现（API 未导出 update）。
 * 行的 source 缺失时明确失败（tracked 行理论上恒有 lock source）。
 */
export async function reinstallSkill(
    name: string,
    source: string | null | undefined,
    options: { global: boolean; cwd?: string },
): Promise<SkillActionResult> {
    if (!source) return { ok: false, error: `Skill has no recorded source: ${name}` }
    const result = await installSkills(source, {
        agents: ['claude-code'],
        ...toSkillsCallOptions(options),
        skills: [name],
    })
    if (result.installed.some(t => t.skill === name)) return { ok: true }
    const failure = result.failed.find(f => f.skill === name)
    return { ok: false, error: failure?.message ?? 'update failed' }
}

/**
 * 生效安装判定（纯函数，scope 感知）：同名条目按「近层覆盖」解析。
 * - global 视角只看 global 层；
 * - workspace 视角 project 层优先，无 project 条目时回落 global（全局已装在项目里同样生效）。
 * 两层同名条目在 InstalledSkillRef 中各自带 scope、无损共存——判定与调用方的列表拼接顺序无关。
 */
export function resolveEffectiveInstall(
    view: SkillInstallScope,
    name: string,
    installedRefs: InstalledSkillRef[],
): InstalledSkillRef | null {
    if (view === 'workspace') {
        const projectRef = installedRefs.find(ref => ref.scope === 'workspace' && ref.name === name)
        if (projectRef) return projectRef
    }
    return installedRefs.find(ref => ref.scope === 'global' && ref.name === name) ?? null
}

/**
 * repo 清单 × 已装清单 → 复选框数据源（纯函数，测试直接覆盖）。
 *
 * - installed（readonly）：生效条目的 source 与本 repo 一致；
 * - conflict（警告）：生效条目同名但 source 不同（含 untracked 的 null）——安装会
 *   覆盖别家真身，UI 必须提示；installed 与 conflict 互斥（已装优先展示 readonly）
 * - 「生效条目」由 {@link resolveEffectiveInstall} 按视角解析（近层覆盖），
 *   不再依赖调用方「global 清单拼在 project 前面」这一顺序约定
 */
export function mergeAvailableWithInstalled(
    repoSource: string,
    repoSkills: RepoSkillOption[],
    installedRefs: InstalledSkillRef[],
    view: SkillInstallScope,
): SkillAvailableInfo[] {
    return repoSkills.map(skill => {
        const effective = resolveEffectiveInstall(view, skill.name, installedRefs)
        const installed = effective?.source === repoSource
        const conflict = Boolean(effective && effective.source !== repoSource)
        return { name: skill.name, description: skill.description, installed, conflict }
    })
}
