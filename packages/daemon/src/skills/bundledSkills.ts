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
 * CC 内置 bundled skill 名单（skill-mgmt 票 06）：daemon 自采 + 版本化缓存，零硬编码。
 *
 * 采集法（2026-11-12 实测实锤，探测脚本 packages/session/scripts/probe-bundled-skills.ts）：
 * headless SDK query → init 帧带 `skills: string[]`（真技能名单，含 bundled 与磁盘 skill）
 * + `claude_code_version`；`supportedCommands()` 的 SlashCommand 带 `builtin` 标但分不出
 * 技能与纯命令——两者交集（builtin 且在 init.skills）即内置技能名单，纯命令（clear/compact…）
 * 与用户磁盘 skill（非 builtin）天然排除。
 *
 * 注：spec 原稿的 usage 帧 `skills.skillFrontmatter` 路线已否决——其宿主 getContextUsage
 * 会真调 LLM API（memory 实锤），init.skills 交集法同等效力且全程免费。
 *
 * 缓存键 = claude CLI 版本（`<claude> --version` 秒级探针）：CLI 升级自然 miss 重采，
 * 同版本后续请求纯缓存命中。采集 cwd = $TMPDIR/mobi-probe 固定单目录（采前 rm 重建清孤儿、
 * 用完即删；通用名供迭代 2/3 mcp/plugin 探测复用），与 workspace 解耦、零用户前置状态。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { BundledSkillInfo } from '@mobi/shared'
import { getClaudeExecutablePath } from '@mobi/node-core/claudeSdk/claudeExecutable'
import { daemonLogger } from '../logger'

/** 缓存文档（{dataDir}/bundled-skills.json） */
export interface BundledSkillsCache {
    /** 采集时的 claude CLI 版本（缓存键） */
    claudeVersion: string
    skills: BundledSkillInfo[]
    cachedAt: number
}

/** 采集结果 */
export interface BundledProbeResult {
    claudeVersion: string
    skills: BundledSkillInfo[]
}

/** 可注入的采集器（测试 fake；生产 = 真 SDK probe） */
export type BundledProber = () => Promise<BundledProbeResult>

/** 可注入的版本探针（测试 fake；生产 = spawn claude --version） */
export type ClaudeVersionProber = () => Promise<string>

/** supportedCommands 快照的最小投影（SlashCommand 子集，纯函数不依赖 SDK 类型） */
export interface CommandSnapshot {
    name: string
    description: string
    builtin?: boolean
}

/**
 * 交集法：builtin 标记且出现在 init.skills 的命令 = 内置技能。
 * 名字对齐：SlashCommand.name 无 / 前缀；init.skills 同为无前缀（防御性兼容带前缀形态）。
 * description 取自 commands 快照（init.skills 只有名字数组）。
 */
export function computeBundledSkills(initSkills: string[], commands: CommandSnapshot[]): BundledSkillInfo[] {
    const skillNames = new Set(initSkills.map(s => s.replace(/^\//, '')))
    return commands
        .filter(c => c.builtin && skillNames.has(c.name))
        .map(c => ({ name: c.name, description: c.description }))
}

/** 读缓存：文件缺失/损坏/形状不符 → null（自然走重采） */
export function readBundledCache(cachePath: string): BundledSkillsCache | null {
    if (!existsSync(cachePath)) return null
    try {
        const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as BundledSkillsCache
        if (typeof parsed?.claudeVersion !== 'string' || !Array.isArray(parsed?.skills)) return null
        return parsed
    } catch {
        return null
    }
}

/** 写缓存（最小文档，2 空格 + 尾换行） */
export function writeBundledCache(cachePath: string, data: BundledSkillsCache): void {
    writeFileSync(cachePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

/** mobi-probe 临时目录：固定单目录，采前 rm 重建清孤儿（防累积） */
function createProbeDir(): string {
    const dir = join(tmpdir(), 'mobi-probe')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * 真采集器：一次性 headless SDK query（进程内直连、不经会话登记管线、不留在会话列表）。
 * init 帧（skills + claude_code_version）+ supportedCommands() → 交集；用完即删临时目录。
 */
export async function probeBundledSkills(): Promise<BundledProbeResult> {
    const probeDir = createProbeDir()
    try {
        const q = query({
            // 一轮极短 turn：只求 init 帧 + supportedCommands，不消耗结果内容
            prompt: 'Reply with just: OK',
            options: {
                cwd: probeDir,
                permissionMode: 'bypassPermissions',
                maxTurns: 1,
            },
        })

        let initSkills: string[] = []
        let claudeVersion = ''
        // 读完整个流（maxTurns:1 + 极短 prompt，秒级收尾）——break 断流会留下未收尾的
        // 子进程，daemon 长驻进程不能这样漏
        for await (const message of q) {
            if (message.type === 'system' && message.subtype === 'init') {
                const init = message as { skills?: string[]; claude_code_version?: string }
                initSkills = init.skills ?? []
                claudeVersion = init.claude_code_version ?? ''
            }
        }
        if (!claudeVersion) throw new Error('probe: init frame missing claude_code_version')

        const commands = await q.supportedCommands()
        const skills = computeBundledSkills(initSkills, commands)
        daemonLogger.info(`[skills] bundled 自采完成：v${claudeVersion}，${skills.length} 项`)
        return { claudeVersion, skills }
    } finally {
        rmSync(probeDir, { recursive: true, force: true })
    }
}

/** 版本探针：spawn claude --version（秒级；CLI 独立升级后自然触发重采） */
export async function probeClaudeVersion(): Promise<string> {
    const claudePath = (await getClaudeExecutablePath()) ?? 'claude'
    const proc = Bun.spawn([claudePath, '--version'], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exitCode !== 0) throw new Error(`claude --version exited ${exitCode}`)
    // 输出形如 "2.1.312 (Claude Code)"——取首个空白前 token
    const version = stdout.trim().split(/\s+/)[0]
    if (!version) throw new Error('claude --version returned empty output')
    return version
}

/**
 * bundled 名单依赖（架构深化候选⑤自路由层迁入）：缺省生产值 = dataDir 缓存 + 真 SDK 自采。
 */
export interface SkillsBundledDeps {
    cachePath: string
    prober?: BundledProber
    versionProber?: ClaudeVersionProber
}

/**
 * 编排：版本探针 → 缓存命中判定 → miss 自采 → 写缓存。
 * 采集失败异常上抛（调用方 502 透传），绝不伪装空名单、不留半截缓存。
 */
export async function getBundledSkills(deps: SkillsBundledDeps): Promise<BundledProbeResult> {
    const prober = deps.prober ?? probeBundledSkills
    const versionProber = deps.versionProber ?? probeClaudeVersion

    const currentVersion = await versionProber()
    const cached = readBundledCache(deps.cachePath)
    if (cached && cached.claudeVersion === currentVersion) {
        return { claudeVersion: cached.claudeVersion, skills: cached.skills }
    }

    const probed = await prober()
    writeBundledCache(deps.cachePath, { ...probed, cachedAt: Date.now() })
    return probed
}
