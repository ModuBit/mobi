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
 * Skill 磁盘扫描器（skill-mgmt 票 01）：管理页列表的单一事实源。
 *
 * 职责边界：只读扫描与合成（来源/形态/渠道/生效态/同名裁决/损坏隐藏），
 * 写操作（skillOverrides 写归属层、删除、安装）不在本模块——归后续票的独立通道。
 *
 * 语义依据（调研实锤，详见 ~/workspace/rea-analysis/plugin-mcp-mgmt/notes.md）：
 * - 生效态四层合成 managed > local > project > user（官方 settings precedence）
 * - skillOverrides 键按 skill 名匹配、与 skill 所在层无关（user 层可压 project skill）
 * - 同名裁决 personal 胜 project、本地胜 synced；plugin skill 前缀名不参与裸名冲突
 * - 渠道权威 = skills CLI 的 lock 文件（symlink 形态只作展示，不作渠道依据）
 * - synced 目录与 anthropic-skills 前缀名是 CC 保留名
 */
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolveClaudeConfigDir } from '@mobi/node-core/claudeSdk/claudeConfigDir'
import { ALL_BUNDLED_PLUGIN_NAMES, bundledPluginPath } from '@mobi/node-core/runtime/bundledPlugins'
import type { SkillInfo, SkillOverrideState, SkillSettingsLayer, SkillSource } from '@mobi/shared'
import { SKILL_OVERRIDE_STATES, skillNameKey } from '@mobi/shared'
import { scopeView, type SkillScope } from './skillScope'

/** 扫描根（生产缺省值见 defaultSkillScanRoots；测试注入 fixture） */
export interface SkillScanRoots {
    /** 用户级 .claude 目录（个人 + synced + user 层 settings） */
    claudeConfigDir: string
    /** user 级 skills CLI lock（~/.agents/.skill-lock.json） */
    userLockPath: string
    /** 内置插件根目录列表（各根下 skills/ 为其携带 skill） */
    pluginDirs: string[]
    /** managed settings 路径（可能不存在；缺省按平台已知路径探测） */
    managedSettingsPath?: string
}

/** skills CLI lock 文件形状（两把 lock 共用；只取用到的字段） */
interface SkillLockFile {
    skills: Record<string, { source?: string; sourceType?: string; pluginName?: string }>
}

/** macOS / Linux 的 managed settings 已知路径（不存在即跳过该层） */
function defaultManagedSettingsPath(): string {
    if (process.platform === 'darwin') {
        return '/Library/Application Support/ClaudeCode/managed-settings.json'
    }
    return '/etc/claude-code/managed-settings.json'
}

/** 生产缺省扫描根 */
export function defaultSkillScanRoots(): SkillScanRoots {
    return {
        claudeConfigDir: resolveClaudeConfigDir(),
        userLockPath: join(homedir(), '.agents', '.skill-lock.json'),
        pluginDirs: ALL_BUNDLED_PLUGIN_NAMES
            .map(name => bundledPluginPath(name))
            .filter(dir => existsSync(join(dir, 'skills'))),
        managedSettingsPath: defaultManagedSettingsPath(),
    }
}

// ── settings skillOverrides 读取与合成 ──

/** 读单个 settings.json 的 skillOverrides（文件缺失/坏 JSON/形状不对 → 空） */
function readOverrides(path: string): Partial<Record<string, SkillOverrideState>> {
    try {
        if (!existsSync(path)) return {}
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { skillOverrides?: unknown }
        if (!parsed.skillOverrides || typeof parsed.skillOverrides !== 'object') return {}
        const result: Partial<Record<string, SkillOverrideState>> = {}
        for (const [name, value] of Object.entries(parsed.skillOverrides as Record<string, unknown>)) {
            if (typeof value === 'string' && (SKILL_OVERRIDE_STATES as readonly string[]).includes(value)) {
                result[name] = value as SkillOverrideState
            }
        }
        return result
    } catch {
        return {}
    }
}

/**
 * 四层 overrides（高 → 低）。workspace 视角传全部四层；global 视角只传 managed + user
 * （project/local 层依 workspace 而定，无 workspace 语境不参与合成）。
 */
export type OverrideLayers = Array<{ layer: SkillSettingsLayer; overrides: Partial<Record<string, SkillOverrideState>> }>

/** 合成某 skill 名的生效覆盖：取最高层首个条目；无 → null */
function resolveOverride(
    name: string,
    layers: OverrideLayers,
): { state: SkillOverrideState; fromLayer: SkillSettingsLayer } | null {
    for (const { layer, overrides } of layers) {
        const state = overrides[name] ?? overrides[name.toLowerCase()]
        if (state) return { state, fromLayer: layer }
    }
    return null
}

// ── SKILL.md 解析 ──

interface ParsedSkillMd {
    name: string
    description?: string
    modelInvocationDisabled?: boolean
}

/** frontmatter 解析：无 frontmatter / YAML 坏 / 非法名 → null（损坏，调用方隐藏） */
function parseSkillMd(path: string): ParsedSkillMd | null {
    let content: string
    try {
        content = readFileSync(path, 'utf-8')
    } catch {
        return null
    }
    let front: Record<string, unknown> = {}
    if (content.startsWith('---')) {
        const end = content.indexOf('\n---', 3)
        if (end === -1) return null
        try {
            const parsed = parseYaml(content.slice(3, end)) as unknown
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
            front = parsed as Record<string, unknown>
        } catch {
            return null
        }
    }
    const name = typeof front.name === 'string' && front.name.trim() ? front.name.trim() : ''
    // CC 保留名与非法字符（零宽/尖括号/控制字符）不加载；字符码判断而非正则
    //（no-control-regex / no-irregular-whitespace 双 lint 零容忍）
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)
    const hasIrregularChar = [...name].some(
        ch => ch.charCodeAt(0) < 0x20 || ch === '<' || ch === '>' || ch === ZERO_WIDTH_SPACE,
    )
    if (!name || name.toLowerCase().startsWith('anthropic-skills') || hasIrregularChar) {
        return null
    }
    return {
        name,
        description: typeof front.description === 'string' && front.description ? front.description : undefined,
        modelInvocationDisabled: front['disable-model-invocation'] === true || undefined,
    }
}

// ── 目录扫描 ──

/** 单个 skill 目录集合（如 ~/.claude/skills 或 <ws>/.claude/skills）的一条扫描结果 */
interface ScannedEntry {
    parsed: ParsedSkillMd
    dirPath: string
    form: 'symlink' | 'directory'
    symlinkTarget?: string
}

/**
 * 扫描一层 skill 目录（目录名约定：<dir>/<skill-name>/SKILL.md）。
 * syncedDir=true 时目录本身是保留名 synced/（其下条目来源为 synced）。
 * 返回损坏条目已剔除的清单；同名（目录内不同名目录产出同名 frontmatter name）保留首个。
 */
function scanSkillDirectory(dir: string): ScannedEntry[] {
    let entries
    try {
        entries = readdirSync(dir, { withFileTypes: true })
    } catch {
        return []
    }
    const seen = new Set<string>()
    const result: ScannedEntry[] = []
    for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        if (entry.name === 'synced' || entry.name.startsWith('.')) continue
        const dirPath = join(dir, entry.name)
        const isSymlink = entry.isSymbolicLink()
        const mdPath = join(dirPath, 'SKILL.md')
        // symlink → 从目标读 SKILL.md；断链（目标消失）按损坏隐藏
        const readPath = isSymlink ? resolveSymlinkTarget(mdPath) : mdPath
        if (!readPath) continue
        const parsed = parseSkillMd(readPath)
        if (!parsed) continue
        const key = skillNameKey(parsed.name)
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
            parsed,
            dirPath,
            form: isSymlink ? 'symlink' : 'directory',
            symlinkTarget: isSymlink ? readlinkSync(dirPath) : undefined,
        })
    }
    return result
}

/** 断链解析：symlink 目录下 SKILL.md 经真实路径可达则返回，否则 null（existsSync 出错即 false，不抛） */
function resolveSymlinkTarget(mdPath: string): string | null {
    return existsSync(mdPath) ? mdPath : null
}

/** 读 skills CLI lock（文件缺失/坏 JSON → 空） */
function readLock(path: string): SkillLockFile {
    try {
        if (!existsSync(path)) return { skills: {} }
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SkillLockFile
        return parsed?.skills && typeof parsed.skills === 'object' ? parsed : { skills: {} }
    } catch {
        return { skills: {} }
    }
}

/** 组装 SkillInfo 公共字段 */
function toSkillInfo(
    entry: ScannedEntry,
    source: SkillSource,
    lockEntry: SkillLockFile['skills'][string] | undefined,
    layers: OverrideLayers,
    ownLayer: SkillSettingsLayer | null,
): SkillInfo {
    const effective = resolveOverride(skillNameKey(entry.parsed.name), layers)
    const own = ownLayer
        ? (layers.find(l => l.layer === ownLayer)?.overrides[skillNameKey(entry.parsed.name)] ?? null)
        : null
    return {
        name: entry.parsed.name,
        description: entry.parsed.description,
        source,
        form: entry.form,
        symlinkTarget: entry.symlinkTarget,
        path: join(entry.dirPath, 'SKILL.md'),
        tracked: Boolean(lockEntry),
        installSource: lockEntry?.source,
        modelInvocationDisabled: entry.parsed.modelInvocationDisabled,
        // synced 的启停归 claude.ai 账户、plugin 归迭代 3，均不提供开关
        overrideable: source === 'personal' || source === 'project',
        // 删除只对 mobi 自管来源开放：synced 下次同步拉回、plugin 归迭代 3（能力矩阵单源，daemon 守卫与 web 入口消费）
        deletable: source === 'personal' || source === 'project',
        effectiveState: effective?.state ?? null,
        effectiveFromLayer: effective?.fromLayer ?? null,
        ownState: own ?? null,
    }
}

/** global 视角四层中的两层（project/local 无 workspace 语境不参与）；路径族经 scopeView 单源 */
function globalLayers(roots: SkillScanRoots): OverrideLayers {
    return [
        { layer: 'managed', overrides: readOverrides(roots.managedSettingsPath ?? '') },
        { layer: 'user', overrides: readOverrides(scopeView(roots, { kind: 'global' }).ownSettingsPath) },
    ]
}

/** workspace 视角全四层（managed > local > project > user）；归属/settings 路径经 scopeView 单源 */
function workspaceLayers(roots: SkillScanRoots, wsPath: string): OverrideLayers {
    const wsScope: SkillScope = { kind: 'workspace', path: wsPath }
    return [
        { layer: 'managed', overrides: readOverrides(roots.managedSettingsPath ?? '') },
        { layer: 'local', overrides: readOverrides(join(wsPath, '.claude', 'settings.local.json')) },
        { layer: 'project', overrides: readOverrides(scopeView(roots, wsScope).ownSettingsPath) },
        { layer: 'user', overrides: readOverrides(scopeView(roots, { kind: 'global' }).ownSettingsPath) },
    ]
}

/** global 视角清单：个人 + synced + 插件携带（CC 内置归票 06 的独立端点） */
export function listGlobalSkills(roots: SkillScanRoots): SkillInfo[] {
    const layers = globalLayers(roots)
    const userLock = readLock(roots.userLockPath)
    const skillsDir = scopeView(roots, { kind: 'global' }).skillRoot

    const personal = scanSkillDirectory(skillsDir)
    const personalKeys = new Set(personal.map(e => skillNameKey(e.parsed.name)))

    // synced：目录在保留名 synced/ 下；被本地同名遮蔽的不加载
    const synced = scanSkillDirectory(join(skillsDir, 'synced'))
        .filter(e => !personalKeys.has(skillNameKey(e.parsed.name)))

    const result: SkillInfo[] = [
        ...personal.map(e => toSkillInfo(e, 'personal', userLock.skills[e.parsed.name], layers, 'user')),
        ...synced.map(e => toSkillInfo(e, 'synced', userLock.skills[e.parsed.name], layers, null)),
    ]

    // 插件携带：前缀名空间，不参与裸名冲突；skillOverrides 不作用于插件 skill
    for (const pluginDir of roots.pluginDirs) {
        const pluginName = pluginDir.split('/').pop() ?? pluginDir
        for (const entry of scanSkillDirectory(join(pluginDir, 'skills'))) {
            result.push({
                ...toSkillInfo(entry, 'plugin', undefined, [], null),
                pluginName,
            })
        }
    }
    return result
}

/** workspace 视角清单：该项目目录下的 project skill（被 personal 同名遮蔽的不返回） */
export function listWorkspaceSkills(roots: SkillScanRoots, wsPath: string): SkillInfo[] {
    const layers = workspaceLayers(roots, wsPath)
    const lock = readLock(join(wsPath, 'skills-lock.json'))
    const personalKeys = new Set(
        scanSkillDirectory(scopeView(roots, { kind: 'global' }).skillRoot).map(e => skillNameKey(e.parsed.name)),
    )

    return scanSkillDirectory(scopeView(roots, { kind: 'workspace', path: wsPath }).skillRoot)
        .filter(e => !personalKeys.has(skillNameKey(e.parsed.name)))
        .map(e => toSkillInfo(e, 'project', lock.skills[e.parsed.name], layers, 'project'))
}

/**
 * PATCH 回读：写完归属层 override 后只重读 override 层重算生效三态（遮蔽态由多层合成，
 * 回读是唯一权威）。其余字段源自 SKILL.md/lock，不可能因这次写入变化——避免为回读
 * 一行重跑整轮目录扫描（每次开关省 N 次 SKILL.md 读取 + YAML 解析）。
 */
export function refreshOverrideFields(skill: SkillInfo, roots: SkillScanRoots, scope: SkillScope): SkillInfo {
    const layers = scope.kind === 'global' ? globalLayers(roots) : workspaceLayers(roots, scope.path)
    const effective = resolveOverride(skillNameKey(skill.name), layers)
    const ownLayer = skill.source === 'project' ? 'project' : 'user'
    const own = layers.find(l => l.layer === ownLayer)?.overrides[skillNameKey(skill.name)] ?? null
    return {
        ...skill,
        effectiveState: effective?.state ?? null,
        effectiveFromLayer: effective?.fromLayer ?? null,
        ownState: own,
    }
}
