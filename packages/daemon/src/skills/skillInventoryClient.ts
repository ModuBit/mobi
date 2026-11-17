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

/** 已装 skill 的判定引用（listSkills 项的最小集） */
export interface InstalledSkillRef {
    name: string
    /** owner/repo 短名（global/project tracked 均有）；null = untracked（本地自管） */
    source: string | null
}

/** installSkills 的结构化结果（按 mobi 需要收窄） */
export interface InstallSelectedResult {
    installed: string[]
    failed: Array<{ skill: string; error: string }>
}

/** 从 github url 提取 owner/repo 短名（与 listSkills 的 source 同形；非 github url 原样返回） */
export function repoShortName(url: string): string {
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    return m ? `${m[1]}/${m[2]}` : url
}

/** resolveSource 句柄缓存：available 阶段的克隆留给 install 复用（installSkills 直接吃
 *  SkillSource，免二次 clone）；TTL 到期/超上限时释放临时目录 */
export interface SourceCache {
    /** 取（或首次解析）源句柄；同源并发调用共享同一次解析 */
    acquire(source: string): Promise<SkillSource>
    /** 命中则返回缓存句柄（install 复用），未命中 undefined */
    get(source: string): SkillSource | undefined
    /** 释放并移除缓存条目（dispose 临时目录） */
    release(source: string): Promise<void>
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
    const entries = new Map<string, { handle: SkillSource; timer: ReturnType<typeof setTimeout> }>()
    const inflight = new Map<string, Promise<SkillSource>>()
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

    const disposeEntry = async (source: string): Promise<void> => {
        const entry = entries.get(source)
        if (!entry) return
        // 先同步摘除再 await：并发 release/淘汰不会重复 dispose
        entries.delete(source)
        clearTimeout(entry.timer)
        await entry.handle.dispose().catch(() => {})
    }

    return {
        async acquire(source) {
            const hit = entries.get(source)
            if (hit) return hit.handle
            const pending = inflight.get(source)
            if (pending) return pending
            const resolving = serializeResolve(() => resolve(source)).then((handle) => {
                while (entries.size >= maxEntries) {
                    const oldest = entries.keys().next().value
                    if (oldest === undefined) break
                    void disposeEntry(oldest)
                }
                const timer = setTimeout(() => { void disposeEntry(source) }, ttlMs)
                // 不因 TTL 定时器拖住宿主进程退出
                timer.unref?.()
                entries.set(source, { handle, timer })
                return handle
            }).finally(() => {
                inflight.delete(source)
            })
            inflight.set(source, resolving)
            return resolving
        },
        get(source) {
            return entries.get(source)?.handle
        },
        release: disposeEntry,
    }
}

/** 生产缓存（resolveSource 直连 skills 包） */
export const defaultSourceCache = createSourceCache(source => resolveSource(source))

/** 解析 repo 可用清单（句柄转交缓存：install 复用同一次克隆；损坏 skill 已被 API 过滤） */
export async function resolveRepoSkills(source: string): Promise<{ repoSource: string; skills: RepoSkillOption[] }> {
    const handle = await defaultSourceCache.acquire(source)
    return {
        repoSource: repoShortName(handle.source.url),
        skills: handle.skills.map(s => ({ name: s.name, description: s.description })),
    }
}

/** 列指定 scope 的已装清单（仅 claude-code agent——安装判定面与其他 agent 无关） */
export async function listInstalledSkillRefs(options: { global: boolean; cwd?: string }): Promise<InstalledSkillRef[]> {
    const result = await listSkills({
        scope: options.global ? 'global' : 'project',
        agents: ['claude-code'],
        ...(options.cwd ? { cwd: options.cwd } : {}),
    })
    return result.skills.map(s => ({ name: s.name, source: s.source ?? null }))
}

/** 选择性安装（skills 缺省 = repo 全装；project scope 必须带 cwd 定位）。
 *  available 阶段缓存了源句柄时直接复用（installSkills 接受 SkillSource，免二次 clone），
 *  安装成功后释放临时目录；失败保留缓存供重试 */
export async function installSelectedSkills(
    source: string,
    skillNames: string[] | null,
    options: { global: boolean; cwd?: string },
): Promise<InstallSelectedResult> {
    const cached = defaultSourceCache.get(source)
    const result = await installSkills(cached ?? source, {
        agents: ['claude-code'],
        scope: options.global ? 'global' : 'project',
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(skillNames ? { skills: skillNames } : {}),
    })
    if (cached) await defaultSourceCache.release(source)
    return {
        installed: result.installed.map(t => t.skill),
        failed: result.failed.map(f => ({ skill: f.skill, error: f.message })),
    }
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
        scope: options.global ? 'global' : 'project',
        ...(options.cwd ? { cwd: options.cwd } : {}),
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
        scope: options.global ? 'global' : 'project',
        ...(options.cwd ? { cwd: options.cwd } : {}),
        skills: [name],
    })
    if (result.installed.some(t => t.skill === name)) return { ok: true }
    const failure = result.failed.find(f => f.skill === name)
    return { ok: false, error: failure?.message ?? 'update failed' }
}

/**
 * repo 清单 × 已装清单 → 复选框数据源（纯函数，测试直接覆盖）。
 *
 * - installed（readonly）：判定键 (source, name)。global 视角只看全局已装；
 *   project 视角调用方传入全局∪项目的并集——全局已装的在项目里同样生效，
 *   再装一份纯属冗余（项目覆盖全局同名版本的高级玩法不经由 UI）
 * - conflict（警告）：同名但 source 不同（含 untracked 的 null）——安装会覆盖
 *   别家真身，UI 必须提示；installed 与 conflict 互斥（已装优先展示 readonly）
 */
export function mergeAvailableWithInstalled(
    repoSource: string,
    repoSkills: RepoSkillOption[],
    installedRefs: InstalledSkillRef[],
): SkillAvailableInfo[] {
    return repoSkills.map(skill => {
        const hit = installedRefs.find(ref => ref.name === skill.name)
        const installed = Boolean(hit && hit.source === repoSource)
        const conflict = Boolean(hit && hit.source !== repoSource)
        return { name: skill.name, description: skill.description, installed, conflict }
    })
}
