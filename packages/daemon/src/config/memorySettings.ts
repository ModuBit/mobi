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
 * 记忆设置与会话级裁决（.scratch/agent-memory 票 02）：
 * daemon 记忆设置块 → 「本会话是否挂记忆插件」的唯一裁决 + 会话子进程 env 契约 +
 * mobi 管理的 hindsight 配置文件生成（拓扑：全局个人 bank + 项目溯源 tag）。
 *
 * env 契约（session 侧挂载信号，node-core bundledPlugins 消费）：
 * - `MOBI_MEMORY_ENGINE=hindsight` → 会话进程挂载 vendored memory-hindsight 插件
 * - `HINDSIGHT_API_URL` / `HINDSIGHT_API_TOKEN` → 插件连接信息
 * - `HINDSIGHT_CONFIG` → mobi 管理配置文件路径（隔离用户自有 ~/.hindsight 配置：
 *   hindsight 配置分层「默认 < env < 文件」，不重定位则 env 注入被用户文件覆盖）
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
// 设置形状单源在 shared 协议（web 提交/回显同 schema 派生，双定义必漂移）。
// re-export 保持 daemon 包内既有 import 路径（settings.ts / lifecycle.ts）不动
import type { MemorySettings, MemoryRule, MemoryIsolationMode } from '@mobi/shared'
import { expandHomePath, isWithinDir } from '@mobi/shared/pathSecurity'
import { writeFileAtomic } from '@mobi/node-core/git/atomicWrite'
export type { MemorySettings, MemoryRule }

/**
 * 记忆设置块（settings.daemon.json `memory` 字段；v1 引擎仅 hindsight）。
 * 形状权威见 @mobi/shared MemorySettingsSchema。
 */

/** mobi 管理的 hindsight 配置文件根目录（per-scope 文件在其 projects/ 下） */
export const MEMORY_MANAGED_CONFIG_REL_PATH = join('memory', 'hindsight')

/** per-scope 配置文件名清洗：非法字符归一为 `_`（basename 已无分隔符，防 `..` 等） */
function projectSlug(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+$/, '_') || 'default'
}

/** 全局池默认 bank 名（normal/open 共用；bankName 设置项可覆盖） */
const GLOBAL_BANK_DEFAULT = 'mobi-global'

/** isolated 档派生 bank 前缀（`mobi-iso-<tag/gitProject>`，与 global 对仗） */
const ISO_BANK_PREFIX = 'mobi-iso-'

/**
 * 会话记忆裁决结果：
 * - active=false 携带原因（off / 配置非法 / workspace 被排除），会话正常启动不挂载
 * - active=true 携带注入子进程的 env
 */
export type SessionMemoryResolution =
    | { active: false; reason: 'off' | 'invalid-endpoint' | 'workspace-excluded'; env: Record<string, never> }
    | { active: true; engine: 'hindsight'; env: Record<string, string> }

/** workspace 排除匹配：前缀语义（`/a/b` 覆盖其下所有会话目录），~ 展开 */
function isWorkspaceDisabled(disabled: string[] | undefined, directory: string): boolean {
    if (!disabled?.length) return false
    const dir = expandHomePath(directory, homedir())
    return disabled.some((entry) => {
        const e = expandHomePath(entry.trim(), homedir())
        return e ? isWithinDir(dir, e) : false
    })
}

/** 归一化引擎值（未知值视为 off，fail-closed） */
function normalizeEngine(raw: unknown): 'off' | 'hindsight' {
    return raw === 'hindsight' ? 'hindsight' : 'off'
}

/**
 * 隔离规则解析（纯函数，spec 三档定稿裁决序）：
 * **路径规则（最长前缀优先）> workspace 规则（按 spawn 的 workspaceId 直查）> 默认 normal**。
 *
 * - workspace 档位跟会话的工作区语境走，不听目录——同目录挂多个不同档 workspace 时，
 *   从哪个 workspace spawn 就用哪个档（spawn options.workspaceId 是明确语境，无歧义）
 * - 路径规则作裸目录 spawn 兜底（无 workspaceId 时 workspace 档跳过）
 * - 路径前缀匹配对齐 hook mapLookup 语义（normalize + 尾分隔符归一，~ 展开）
 */
export function resolveMemoryRule(
    rules: MemoryRule[] | undefined,
    directory: string,
    workspaceId: string | undefined,
): MemoryRule | undefined {
    if (!rules?.length) return undefined
    const dir = expandHomePath(directory, homedir())
    let best: { rule: MemoryRule; len: number } | undefined
    for (const rule of rules) {
        if (rule.target.type === 'path') {
            // 相对路径规则跳过（resolve 语义会把相对前缀并到 cwd 造成误命中）
            const e = expandHomePath(rule.target.path.trim(), homedir())
            if (!e || !isAbsolute(e)) continue
            // 最长前缀优先：更精确的路径规则盖过更宽的（isWithinDir 内部 resolve 归一，对齐 hook mapLookup 语义）
            if (isWithinDir(dir, e) && (!best || e.length > best.len)) best = { rule, len: e.length }
        } else if (rule.target.type === 'workspace' && workspaceId && rule.target.id === workspaceId) {
            // 路径规则恒优先于 workspace 规则（best 已命中路径时不动）
            if (!best) best = { rule, len: -1 }
        }
    }
    return best?.rule
}

/**
 * 会话级记忆裁决（纯函数，executor spawn 时按会话目录逐次求值——设置文件变更
 * 自然落到下一个新会话，与「下会话生效」语义一致）。
 */
export function resolveSessionMemory(
    memory: MemorySettings | undefined,
    workspaceDirectory: string,
    /** mobi 管理配置文件的绝对路径（HINDSIGHT_CONFIG 值），由装配层传入 */
    managedConfigPath: string,
): SessionMemoryResolution {
    if (normalizeEngine(memory?.engine) !== 'hindsight') {
        return { active: false, reason: 'off', env: {} }
    }
    // 配置非法降级：engine 开但 endpoint 缺——不阻断会话启动（调用方记诊断日志）
    if (!memory?.endpoint || !memory.endpoint.trim()) {
        return { active: false, reason: 'invalid-endpoint', env: {} }
    }
    if (isWorkspaceDisabled(memory.disabledWorkspaces, workspaceDirectory)) {
        return { active: false, reason: 'workspace-excluded', env: {} }
    }
    const env: Record<string, string> = {
        MOBI_MEMORY_ENGINE: 'hindsight',
        HINDSIGHT_API_URL: memory.endpoint.trim(),
        HINDSIGHT_CONFIG: managedConfigPath,
    }
    if (memory.apiToken?.trim()) {
        env.HINDSIGHT_API_TOKEN = memory.apiToken.trim()
    }
    return { active: true, engine: 'hindsight', env }
}

/** 伙伴画像知识页（omp seeds 语义：只记跨会话反复出现的稳定偏好，不记一次性请求） */
const USER_PROFILE_PAGE = {
    source_query:
        'What does the user prefer in coding style, tooling, communication, and daily life? '
        + 'Capture only durable preferences expressed across sessions, not one-off requests.',
}

/**
 * scope 身份单源（纯函数）：mode/tag/bankId/slug 一处推导，build（文件内容）与
 * sync（文件名 slug）消费同一结果——文件名与内容不可能错位。
 * tag 缺省链 = rule.tag 覆盖（共享组名）→ gitProject → 'default'。
 * isolated 档 bank 覆盖时 slug 带 bank+tag 双标识：同 tag 不同 bank（同名仓库各隔各的）
 * 与同 bank 不同 tag（多仓库共用一库）两个方向都不能共用文件——retainTags/bankId
 * 任一不同，共用即后写者管辖前者的会话。
 */
export function resolveMemoryScope(
    memory: Pick<MemorySettings, 'bankName'>,
    gitProject?: string,
    rule?: MemoryRule,
): { mode: MemoryIsolationMode; tag: string; bankId: string; slug: string } {
    const mode = rule?.mode ?? 'normal'
    const tag = rule?.tag?.trim() || gitProject || 'default'
    const bank = rule?.bank?.trim()
    const bankId = mode === 'isolated'
        ? (bank || `${ISO_BANK_PREFIX}${tag}`)
        : (memory.bankName?.trim() || GLOBAL_BANK_DEFAULT)
    const slug = mode === 'isolated' && bank
        ? `${mode}-${bank}-${tag}`
        : `${mode}-${tag}`
    return { mode, tag, bankId, slug }
}

/**
 * 生成 mobi 管理的 hindsight 配置文件内容（纯函数，三档隔离 spec 定稿）。
 * 只在会话裁决 active 后调用（lifecycle 先判 off/非法/排除再付 I/O）——settings
 * 语义收紧为「已开启的设置」。gitIngest/冷启动重导入默认关（个人记忆不装
 * commit log）；autoUpdate 关（vendored 版本权威归 mobi 发版）。
 *
 * 三档形态（tag 一律 = `rule.tag ?? gitProject`，**展开值弃占位符**——hook 的
 * recallOptions 静态透传不展开 `{gitProject}`，mobi spawn 侧展开写入；retain/recall
 * 两侧 tag 同出 mobi 展开，一致性自动成立）：
 * - normal（默认）：全局池 + `project:<tag>` 溯源 + recall `any(project:<tag>)`
 *   （云端实测 any = 本项目记忆 ∪ 无 tag 全局层）
 * - open：写入同 normal 打 `project:<tag>` 溯源；recall 不配（全量）。
 *   写路径恒定单源——写侧决定不可逆（无 tag 永久失去溯源），读侧随时可收窄/改判
 *   （hindsight tag 迁移实测可事后批量改）
 * - isolated：独立 bank `mobi-iso-<tag>`（rule.bank 覆盖）+ 不过滤（bank 已物理隔离）
 *
 * 已知限制（2026-10-08 实测）：服务端固化会给部分 observation 打知识分类 tags
 * （knowledge:*）——retain tags 不继承（observation_scopes per_tag 实验证伪），any 过滤
 * 下这类带不匹配 tag 的条目被滤（实测 18 条中 1 条）；tags 不支持通配，无法白名单，
 * 记 pending 观察上游。
 */
export function buildMemoryManagedConfig(
    memory: MemorySettings,
    gitProject?: string,
    rule?: MemoryRule,
): string {
    const { mode, tag, bankId } = resolveMemoryScope(memory, gitProject, rule)
    return JSON.stringify({
        apiUrl: memory.endpoint?.trim() ?? '',
        autoUpdate: false,
        gitIngest: false,
        bankId,
        // 写入恒定打项目溯源 tag（展开值）——三档写路径单源，档位差异只体现在召回侧
        retainTags: [`project:${tag}`],
        ...(mode === 'normal' ? { recallOptions: { tags: [`project:${tag}`], tags_match: 'any' } } : {}),
        customPages: {
            'User Profile': USER_PROFILE_PAGE,
        },
    }, null, 4)
}

/**
 * 同步 mobi 管理的 per-scope hindsight 配置文件（幂等：内容未变不写盘，避免刷新 mtime）。
 * per-scope：每个（档位 × tag）组合一份（isolated 与 normal 同 tag 也分文件，
 * bank 互异不可共用），同 scope 幂等复用。原子写走 writeFileAtomic（tmp + rename
 * 统一纪律，自带 mkdir 与 pid 后缀防并发碰撞）。
 */
export async function syncMemoryManagedConfig(
    dataDir: string,
    memory: MemorySettings,
    gitProject?: string,
    rule?: MemoryRule,
): Promise<string> {
    const { slug } = resolveMemoryScope(memory, gitProject, rule)
    const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', `${projectSlug(slug)}.json`)
    const content = buildMemoryManagedConfig(memory, gitProject, rule)
    try {
        if (readFileSync(target, 'utf-8') === content) {
            return target
        }
    } catch {
        // 首次生成（文件不存在）走下方写盘
    }
    await writeFileAtomic(target, content)
    return target
}
