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
 * 能力面（slash command / agent / model）取数目录。
 *
 * 两个入口，调用方按"有没有活 Query"二选一：
 * - {@link readLiveCapabilities}：会话自己的 Query，零新增进程；
 * - {@link createCapabilityCatalog}：无会话时按 cwd 记忆化，最后回退临时探针。
 *
 * 取数层级的参照是 Claude Desktop 的 `commandAndAgentLists`：
 * 活 Query → per-cwd memo（30s fresh / 10min SWR）→ 临时 query。签名只在请求到达时
 * 用 stat 现算，不做文件监听（新鲜度只在请求时刻有意义，watch 在原子写/递归场景不可靠）。
 */

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Dirent } from 'node:fs'
import type { AgentInfo, ModelInfo, SDKMetadata, SlashCommand } from '@mobi/shared'
import { logger } from '@mobi/node-core/logger'
import { resolveClaudeConfigDir } from './claudeConfigDir'
import { extractSDKMetadata } from './metadataExtractor'

/** 能力发现所需的 Query 结构子集（不 import SDK 类型，便于测试替身） */
export interface LiveCapabilitySource {
    initializationResult(): Promise<unknown>
    supportedModels(): Promise<ModelInfo[]>
    supportedCommands(): Promise<SlashCommand[]>
    supportedAgents(): Promise<AgentInfo[]>
}

/** initializationResult 中能力面用到的字段（CLI 侧为 snake_case） */
interface InitCapabilityFields {
    output_style?: string
    available_output_styles?: string[]
    account?: SDKMetadata['account']
    fast_mode_state?: SDKMetadata['fastModeState']
}

/**
 * 活 Query 能力面：initializationResult 锚定 initialize 完成，随后并行拉三件套。
 *
 * `supportedCommands()` 返回 `latestCommands ?? init.commands`（SDK 语义），即已包含
 * `commands_changed` 的最新推送。三件套全空视为发现不可信 → 抛错，调用方回退探针。
 */
export async function readLiveCapabilities(source: LiveCapabilitySource): Promise<SDKMetadata> {
    const init = ((await source.initializationResult()) ?? {}) as InitCapabilityFields
    const [models, commands, agents] = await Promise.all([
        source.supportedModels(),
        source.supportedCommands(),
        source.supportedAgents(),
    ])
    if (models.length === 0 && commands.length === 0 && agents.length === 0) {
        throw new Error('live capability source returned an empty set')
    }
    return {
        commands,
        agents,
        models,
        outputStyle: init.output_style,
        availableOutputStyles: init.available_output_styles,
        account: init.account,
        fastModeState: init.fast_mode_state,
    }
}

export interface CapabilityCatalog {
    /** 按 cwd 取能力面：fresh 直接命中，stale 窗口内按输入签名判定，最后才探测 */
    get(cwd: string): Promise<SDKMetadata>
    /** 主动失效（活发现写入了新命令时由装配层调用） */
    invalidate(cwd: string): void
}

export interface CapabilityCatalogOptions {
    /** 临时探针，默认 {@link extractSDKMetadata}（测试注入替身） */
    probe?: (cwd: string) => Promise<SDKMetadata>
    now?: () => number
    /** 输入签名，默认 {@link computeCapabilityInputSignature} */
    signature?: (cwd: string) => Promise<string | null>
    freshMs?: number
    staleMs?: number
    maxEntries?: number
}

interface CatalogEntry {
    metadata: SDKMetadata
    fetchedAt: number
    /** 取数前采样的输入签名；null = 有目录不可读（保守视为"随时可能变"） */
    signature: string | null
}

/** fresh 窗口：对齐 Desktop `LIST_MEMO_TTL_MS` */
export const DEFAULT_FRESH_MS = 30_000
/** stale 窗口：对齐 Desktop `LIST_MEMO_STALE_MS` */
export const DEFAULT_STALE_MS = 600_000
/** daemon 常驻，Desktop 没有的 LRU 上限（防无界增长） */
export const DEFAULT_MAX_ENTRIES = 64

export function createCapabilityCatalog(options: CapabilityCatalogOptions = {}): CapabilityCatalog {
    const probe = options.probe ?? extractSDKMetadata
    const now = options.now ?? Date.now
    const signature = options.signature ?? computeCapabilityInputSignature
    const freshMs = options.freshMs ?? DEFAULT_FRESH_MS
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

    const entries = new Map<string, CatalogEntry>()
    const inflight = new Map<string, Promise<SDKMetadata>>()

    /** Map 插入序即 LRU：命中时移到末尾 */
    function touch(key: string, entry: CatalogEntry): void {
        entries.delete(key)
        entries.set(key, entry)
    }

    function store(key: string, metadata: SDKMetadata, inputs: string | null): void {
        entries.delete(key)
        entries.set(key, { metadata, fetchedAt: now(), signature: inputs })
        while (entries.size > maxEntries) {
            let victim: string | undefined
            for (const k of entries.keys()) {
                if (!inflight.has(k)) {
                    victim = k
                    break
                }
            }
            if (victim === undefined) break
            entries.delete(victim)
        }
    }

    /**
     * 探测并落缓存。single-flight：同一 cwd 的并发请求共享同一个 Promise。
     * 签名在探测**之前**采样——探测期间的变化会在下次请求体现，不会被误记为"已生效"。
     * `knownInputs` 由调用方传入已采样的签名（stale 判定刚算过），省掉重复的文件系统遍历；
     * undefined 才重新采样（null 是合法值，表示根目录不可读）。
     */
    function refresh(key: string, knownInputs?: string | null): Promise<SDKMetadata> {
        const running = inflight.get(key)
        if (running) return running

        const task = (async (): Promise<SDKMetadata> => {
            const inputs = knownInputs !== undefined ? knownInputs : await signature(key)
            try {
                const metadata = await probe(key)
                store(key, metadata, inputs)
                logger.debug('[capability] probe-ok', { cwd: key, signatureKnown: inputs !== null })
                return metadata
            } catch (error) {
                const stale = entries.get(key)
                if (stale && now() - stale.fetchedAt < staleMs) {
                    touch(key, stale)
                    logger.debug('[capability] probe-fail, serving stale', {
                        cwd: key,
                        ageMs: now() - stale.fetchedAt,
                    })
                    return stale.metadata
                }
                logger.debug('[capability] probe-fail', { cwd: key, error: String(error) })
                throw error
            }
        })()

        inflight.set(key, task)
        void task.finally(() => {
            if (inflight.get(key) === task) inflight.delete(key)
        }).catch(() => {
            // 失败由 get() 的调用方接收；这里只做槽位清理
        })
        return task
    }

    return {
        async get(cwd: string): Promise<SDKMetadata> {
            const key = resolve(cwd)
            const entry = entries.get(key)
            if (entry) touch(key, entry)

            const ageMs = entry ? now() - entry.fetchedAt : Number.POSITIVE_INFINITY
            if (entry && ageMs < freshMs) {
                logger.debug('[capability] hit', { cwd: key, ageMs })
                return entry.metadata
            }

            let inputs: string | null | undefined
            if (entry && ageMs < staleMs) {
                inputs = await signature(key)
                if (inputs !== null && entry.signature !== null && inputs === entry.signature) {
                    logger.debug('[capability] revalidate', { cwd: key, ageMs })
                    void refresh(key, inputs).catch(() => {})
                    return entry.metadata
                }
            }

            logger.debug('[capability] miss', { cwd: key, ageMs })
            return refresh(key, inputs)
        },

        invalidate(cwd: string): void {
            entries.delete(resolve(cwd))
        },
    }
}

/** 输入签名覆盖的固定文件与目录（对齐 Desktop `NC`） */
const SIGNATURE_FILES = ['settings.json', 'settings.local.json'] as const
const SIGNATURE_DIRS = ['commands', 'agents', 'skills'] as const
/** readdir 上限（对齐 Desktop `maxEntries: 256`） */
const MAX_SIGNATURE_ENTRIES = 256

/** 单项签名：mtime + size；不存在记 `-`，其余错误同样降级为 `-`（条目级） */
async function statToken(target: string): Promise<string> {
    try {
        const stats = await stat(target)
        return `${stats.mtimeMs}:${stats.size}`
    } catch {
        return '-'
    }
}

/**
 * 目录签名：名字排序后逐项 stat；目录项取 `<name>/SKILL.md`（skills 形态）。
 * 目录存在但读不了 → null（整体签名不可信，调用方保守按"已变化"处理）。
 */
async function directorySignature(dir: string): Promise<string | null> {
    let items: Dirent[]
    try {
        items = await readdir(dir, { withFileTypes: true })
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '-' : null
    }
    const sorted = items
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, MAX_SIGNATURE_ENTRIES)
    const tokens = await Promise.all(
        sorted.map(async (item) => {
            const itemPath = join(dir, item.name)
            const target = item.isDirectory() && !item.isSymbolicLink() ? join(itemPath, 'SKILL.md') : itemPath
            return `${item.name}=${await statToken(target)}`
        }),
    )
    return tokens.join(',')
}

/**
 * 能力输入签名：`~/.claude` 与 `<cwd>/.claude` 下决定命令列表的目录与设置文件。
 * 只 stat 不读内容；任一根目录不可读 → null。
 */
export async function computeCapabilityInputSignature(cwd: string): Promise<string | null> {
    const roots = [...new Set([resolveClaudeConfigDir(), join(resolve(cwd), '.claude')])]
    // 两棵根目录的 stat/readdir 互相独立：并行取，避免 10 次串行文件系统往返
    const parts = await Promise.all(roots.flatMap((root) => [
        ...SIGNATURE_FILES.map(async (file) => `f:${file}=${await statToken(join(root, file))}`),
        ...SIGNATURE_DIRS.map(async (dir) => {
            const inputs = await directorySignature(join(root, dir))
            return inputs === null ? null : `d:${dir}=${inputs}`
        }),
    ]))
    return parts.includes(null) ? null : parts.join('|')
}
