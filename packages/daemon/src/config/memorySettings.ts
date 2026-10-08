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

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
// 设置形状单源在 shared 协议（web 提交/回显同 schema 派生，双定义必漂移）。
// re-export 保持 daemon 包内既有 import 路径（settings.ts / lifecycle.ts）不动
import type { MemorySettings } from '@mobi/shared'
export type { MemorySettings }

/**
 * 记忆设置块（settings.daemon.json `memory` 字段；v1 引擎仅 hindsight）。
 * 形状权威见 @mobi/shared MemorySettingsSchema。
 */

/** mobi 管理的 hindsight 配置文件相对 dataDir 路径 */
export const MEMORY_MANAGED_CONFIG_REL_PATH = join('memory', 'hindsight', 'coding-agent.json')

/** 全局个人 bank 基名（bankNamespace 非空时前缀成 `<ns>::mobi-personal`） */
const PERSONAL_BANK_BASE = 'mobi-personal'

/**
 * 会话记忆裁决结果：
 * - active=false 携带原因（off / 配置非法 / workspace 被排除），会话正常启动不挂载
 * - active=true 携带注入子进程的 env
 */
export type SessionMemoryResolution =
    | { active: false; reason: 'off' | 'invalid-endpoint' | 'workspace-excluded'; env: Record<string, never> }
    | { active: true; engine: 'hindsight'; env: Record<string, string> }

/** ~ 展开为家目录（对齐 hindsight optInPaths 语义） */
function expandHome(p: string): string {
    return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/** workspace 排除匹配：前缀语义（`/a/b` 覆盖其下所有会话目录），~ 展开 */
function isWorkspaceDisabled(disabled: string[] | undefined, directory: string): boolean {
    if (!disabled?.length) return false
    const dir = expandHome(directory)
    return disabled.some((entry) => {
        const e = expandHome(entry.trim())
        return !e ? false : dir === e || dir.startsWith(e.endsWith('/') ? e : e + '/')
    })
}

/** 归一化引擎值（未知值视为 off，fail-closed） */
function normalizeEngine(raw: unknown): 'off' | 'hindsight' {
    return raw === 'hindsight' ? 'hindsight' : 'off'
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
 * 生成 mobi 管理的 hindsight 配置文件内容（纯函数）。
 * 拓扑定稿（spec）：静态全局个人 bank + `project:{gitProject}` 溯源 tag；
 * gitIngest/冷启动重导入默认关（个人 bank 不装 commit log）；
 * autoUpdate 关（vendored 版本权威归 mobi 发版）。
 * 注：recall 侧 tag 过滤（omp per-project-tagged 并集）待票 01 云端实测
 * `{gitProject}` 占位符在 recallOptions 内的展开行为后再接线，默认召回全部相关记忆。
 */
export function buildMemoryManagedConfig(memory: MemorySettings | undefined): string {
    const settings = normalizeEngine(memory?.engine) === 'hindsight' ? memory : undefined
    const bankId = settings?.bankNamespace?.trim()
        ? `${settings.bankNamespace.trim()}::${PERSONAL_BANK_BASE}`
        : PERSONAL_BANK_BASE
    return JSON.stringify({
        apiUrl: settings?.endpoint?.trim() ?? '',
        autoUpdate: false,
        gitIngest: false,
        bankId,
        retainTags: ['project:{gitProject}'],
        ...(settings?.mapPathToBank && Object.keys(settings.mapPathToBank).length > 0
            ? { mapPathToBank: settings.mapPathToBank }
            : {}),
        customPages: {
            'User Profile': USER_PROFILE_PAGE,
        },
    }, null, 4)
}

/**
 * 同步 mobi 管理的 hindsight 配置文件（幂等：内容未变不写盘，避免刷新 mtime）。
 * 原子写 temp + rename，目录权限随 dataDir（0700）。
 */
export function syncMemoryManagedConfig(dataDir: string, memory: MemorySettings | undefined): string {
    const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH)
    const content = buildMemoryManagedConfig(memory)
    try {
        if (readFileSync(target, 'utf-8') === content) {
            return target
        }
    } catch {
        // 首次生成（文件不存在）走下方写盘
    }
    mkdirSync(dirname(target), { recursive: true })
    const tmp = target + '.tmp'
    writeFileSync(tmp, content)
    renameSync(tmp, target)
    return target
}

/** dataDir 下管理配置文件是否已就绪（诊断用） */
export function memoryManagedConfigExists(dataDir: string): boolean {
    return existsSync(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH))
}
