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
 * Skill 管理页契约（skill-mgmt 迭代 1）。
 *
 * 术语对齐 spec：**来源**（五类，本迭代不含 bundled）/ **形态**（symlink|真目录）/
 * **渠道**（tracked=skills CLI lock 有条目）/ **生效态**（多层 settings 的
 * skillOverrides 合成）/ **遮蔽**（被更高层 settings 或同名胜者压制）。
 */
import { z } from 'zod'

/** skill 来源（CC 内置 bundled 归票 06，暂不在枚举中） */
export const SKILL_SOURCES = ['personal', 'synced', 'project', 'plugin'] as const
export type SkillSource = (typeof SKILL_SOURCES)[number]

/** skillOverrides 四态（CC settings 语义，mobi UI 只暴露 on/off 两态） */
export const SKILL_OVERRIDE_STATES = ['on', 'name-only', 'user-invocable-only', 'off'] as const
export type SkillOverrideState = (typeof SKILL_OVERRIDE_STATES)[number]

/** 生效覆盖所在的 settings 层（高→低：managed > local > project > user） */
export const SKILL_SETTINGS_LAYERS = ['managed', 'local', 'project', 'user'] as const
export type SkillSettingsLayer = (typeof SKILL_SETTINGS_LAYERS)[number]

/** skill 目录形态：symlink（多指向中央仓）或真目录 */
export const SKILL_FORMS = ['symlink', 'directory'] as const
export type SkillForm = (typeof SKILL_FORMS)[number]

/**
 * scope 哨兵（wire 协议单源）：workspaceId 参数取此值表示全局（user 级）视角。
 * daemon 的 scope 解析与 web 的 tab/表单取值共用，禁止再写字面量
 * （同构先例：archivedScope 的 ARCHIVED_WORKSPACE_NONE）。
 */
export const SKILL_SCOPE_GLOBAL = 'global'
/** 系统（CC 内置）视角哨兵：仅 tab 消费（bundled 只读、不可装/建/删），wire 上不作为目标 scope */
export const SKILL_SCOPE_BUNDLED = 'bundled'

/**
 * 同名裁决的比较键：CC 忽略大小写与空白（如 `My Skill` 与 `my-skill` 视为同名）。
 * daemon 扫描层的遮蔽裁决与 web 内置行的 covered 判定共用，禁止再手写精确匹配。
 */
export const skillNameKey = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

/**
 * 遮蔽判定：归属层没关（on 或无条目）却被更高层关了——用户在此层开关不会生效。
 * 行渲染（遮蔽徽标）与启停后的压制提示共用（ownState 语义见 SkillInfoSchema 注释）。
 */
export function isSkillShadowed(
    skill: Pick<SkillInfo, 'effectiveState' | 'ownState'> | null | undefined,
): boolean {
    return skill?.effectiveState === 'off' && skill.ownState !== 'off'
}

/** 管理页列表行（GET /api/skills） */
export const SkillInfoSchema = z.object({
    /** 调用名（frontmatter name 优先，缺省目录名） */
    name: z.string(),
    description: z.string().optional(),
    source: z.enum(SKILL_SOURCES),
    form: z.enum(SKILL_FORMS),
    /** form=symlink 时的目标绝对路径 */
    symlinkTarget: z.string().optional(),
    /** SKILL.md 绝对路径 */
    path: z.string(),
    /** 渠道：skills CLI lock（user 级 ~/.agents/.skill-lock.json / project 级 <ws>/skills-lock.json）有无条目 */
    tracked: z.boolean(),
    /** lockEntry.source（如 "vercel-labs/skills"） */
    installSource: z.string().optional(),
    /** 来源=plugin 时的插件名 */
    pluginName: z.string().optional(),
    /** frontmatter disable-model-invocation: true */
    modelInvocationDisabled: z.boolean().optional(),
    /** mobi 可否提供启停开关（personal/project true；plugin false——skillOverrides 对插件 skill 无效） */
    overrideable: z.boolean(),
    /** mobi 可否删除（personal/project true——自管来源；synced 下次同步拉回、plugin 归后续迭代） */
    deletable: z.boolean(),
    /** 合成生效态：多层 skillOverrides 同名键取最高层；null = 无任何覆盖（视为 on） */
    effectiveState: z.enum(SKILL_OVERRIDE_STATES).nullable(),
    /** 生效覆盖来自哪层（effectiveState 非 null 时必填） */
    effectiveFromLayer: z.enum(SKILL_SETTINGS_LAYERS).nullable(),
    /**
     * 归属层（开关写入层）自身的值：personal→user 层、project→project 层；
     * null = 归属层无条目。ownState 为 on/无条目而 effectiveState=off 即「被更高层遮蔽」
     */
    ownState: z.enum(SKILL_OVERRIDE_STATES).nullable(),
})

export type SkillInfo = z.infer<typeof SkillInfoSchema>

export const SkillListResponseSchema = z.object({
    skills: z.array(SkillInfoSchema),
})

export type SkillListResponse = z.infer<typeof SkillListResponseSchema>

/** 系统 skill 行（GET /api/skills/bundled）：CC 内置名单由 daemon 自采，零硬编码 */
export const BundledSkillInfoSchema = z.object({
    /** 调用名（无 / 前缀） */
    name: z.string(),
    /** description 取自 supportedCommands 快照 */
    description: z.string(),
    /** mobi 内置插件携带 skill 的插件名（带此标记 = 插件行，可点进详情；缺省 = CC 内置行） */
    pluginName: z.string().optional(),
})

export const BundledSkillsResponseSchema = z.object({
    /** 采集时的 claude CLI 版本（缓存键） */
    version: z.string(),
    skills: z.array(BundledSkillInfoSchema),
})

export type BundledSkillInfo = z.infer<typeof BundledSkillInfoSchema>
export type BundledSkillsResponse = z.infer<typeof BundledSkillsResponseSchema>

// ── skill 详情（GET /api/skills/detail；点击列表行时按需请求，列表接口不带 body 保持轻） ──

/**
 * SKILL.md frontmatter 扩展字段（官方 20 字段全集的用户可理解子集）。
 * optional = 磁盘上没写（undefined = 详情页不显示该行）；scanner 列表路径不解析这些，
 * 详情端点单独读取，保持列表扫描轻。
 */
export const SkillFrontmatterMetaSchema = z.object({
    /** 补充触发时机/短语（与 description 拼进 listing，共享 1536 字符帽） */
    whenToUse: z.string().optional(),
    /** 自动补全参数提示，如 "[issue-number]" */
    argumentHint: z.string().optional(),
    /** 命名位置参数（$name 替换；空格串或 YAML 列表归一为数组） */
    arguments: z.array(z.string()).optional(),
    /** frontmatter user-invocable（false = 仅 Claude 可用，/ 菜单隐藏） */
    userInvocable: z.boolean().optional(),
    /** 激活 turn 的模型覆盖（或 fork 的模型） */
    model: z.string().optional(),
    /** low | medium | high | xhigh | max */
    effort: z.string().optional(),
    /** frontmatter context: fork（在子代理上下文运行） */
    fork: z.boolean().optional(),
    /** context: fork 时的子代理类型 */
    agent: z.string().optional(),
    /** fork 后台运行（false = 等结果；缺省 true，只有显式 false 才带值） */
    background: z.boolean().optional(),
    /** 自动激活限定的文件 glob（相对 cwd） */
    paths: z.array(z.string()).optional(),
    /** 许可证（Agent Skills spec） */
    license: z.string().optional(),
    /** 环境要求（500 字符内） */
    compatibility: z.string().optional(),
})

export type SkillFrontmatterMeta = z.infer<typeof SkillFrontmatterMetaSchema>

/** skill 详情响应：行数据（与列表同源）+ SKILL.md 正文（frontmatter 后全文）+ 扩展元数据 */
export const SkillDetailResponseSchema = z.object({
    skill: SkillInfoSchema,
    body: z.string(),
    meta: SkillFrontmatterMetaSchema,
})

export type SkillDetailResponse = z.infer<typeof SkillDetailResponseSchema>

// ── 变更类端点的请求体（daemon 路由 safeParse 单源，先例 MemorySettingsSubmissionSchema） ──

/** PATCH /api/skills/:name/visibility（enabled + 视角） */
export const SkillVisibilitySubmissionSchema = z.object({
    enabled: z.boolean(),
    workspaceId: z.string(),
})

/** POST /api/skills/install（source 非空白；skills 缺省 = 全装，向后兼容） */
export const SkillInstallSubmissionSchema = z.object({
    source: z.string().trim().min(1),
    scope: z.string(),
    /** 可选安装清单（两步式安装第二步）：缺省 = repo 内全部 skill */
    skills: z.array(z.string().trim().min(1)).optional(),
})

/** GET /api/skills/available 行：repo 内可选 skill + 已装/冲突标记（安装对话框复选框数据源） */
export const SkillAvailableInfoSchema = z.object({
    name: z.string(),
    description: z.string(),
    /** 当前 scope 生效态已装（global 视角 = 全局已装；project 视角 = 全局∪项目已装）——已装 readonly */
    installed: z.boolean(),
    /** 同名但来自其他来源（含本地 untracked）：安装会整目录覆盖已装真身，UI 须警告 */
    conflict: z.boolean(),
})

export type SkillAvailableInfo = z.infer<typeof SkillAvailableInfoSchema>

/** GET /api/skills/available 响应 */
export const SkillAvailableResponseSchema = z.object({
    skills: z.array(SkillAvailableInfoSchema),
})

export type SkillAvailableResponse = z.infer<typeof SkillAvailableResponseSchema>

/** GET /api/skills/find 行：skills.sh 生态搜索命中（安装对话框「先搜再装」数据源） */
export const SkillRegistrySkillSchema = z.object({
    name: z.string(),
    /** 安装源（owner/repo），可直接作为 available/install 端点的 source */
    source: z.string(),
    /** repo 内 skill 标识（选择段预勾选靶） */
    skillId: z.string(),
    /** skills.sh 生态累计安装数（结果排序参考） */
    installs: z.number(),
})

export type SkillRegistrySkill = z.infer<typeof SkillRegistrySkillSchema>

/** GET /api/skills/find 响应 */
export const SkillRegistrySearchResponseSchema = z.object({
    skills: z.array(SkillRegistrySkillSchema),
})

export type SkillRegistrySearchResponse = z.infer<typeof SkillRegistrySearchResponseSchema>

/** POST /api/skills/:name/update */
export const SkillUpdateSubmissionSchema = z.object({
    workspaceId: z.string(),
})

/** POST /api/skills/create-prompt */
export const SkillCreatePromptSubmissionSchema = z.object({
    scope: z.string(),
})
