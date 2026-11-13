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

/** CC 内置 bundled skill 行（GET /api/skills/bundled；名单由 daemon 自采，零硬编码） */
export const BundledSkillInfoSchema = z.object({
    /** 调用名（无 / 前缀） */
    name: z.string(),
    /** description 取自 supportedCommands 快照 */
    description: z.string(),
})

export const BundledSkillsResponseSchema = z.object({
    /** 采集时的 claude CLI 版本（缓存键） */
    version: z.string(),
    skills: z.array(BundledSkillInfoSchema),
})

export type BundledSkillInfo = z.infer<typeof BundledSkillInfoSchema>
export type BundledSkillsResponse = z.infer<typeof BundledSkillsResponseSchema>
