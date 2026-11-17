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
 * skill 详情解析（点击列表行按需请求）：SKILL.md frontmatter 扩展字段 + 正文全文。
 *
 * 与 scanner 的分工：列表扫描（parseSkillMd）只取 name/description/调用开关三个字段
 * （热路径轻载）；详情页的「官方 20 字段用户可理解子集 + 正文」只在点开时读这一次。
 * symlink 行的 path 已由 scanner 归一为可读路径（读侧无需再解析链接）。
 */
import { readFileSync } from 'node:fs'
import type { SkillFrontmatterMeta } from '@mobi/shared'
import { splitSkillFrontmatter } from './skillScanner'

/** 详情解析结果：正文 + 扩展元数据（没有的字段 undefined，展示层按缺省隐藏） */
export interface ParsedSkillDetail {
    body: string
    meta: SkillFrontmatterMeta
}

/** YAML 值 → string（非法形态忽略该字段） */
function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined
}

/** YAML 值 → string[]（空格/逗号分隔串或 YAML 列表两种官方形态，其余忽略） */
function asStringList(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const items = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        return items.length > 0 ? items : undefined
    }
    if (typeof value === 'string' && value.trim()) {
        const items = value.split(/[\s,]+/).filter(Boolean)
        return items.length > 0 ? items : undefined
    }
    return undefined
}

function asBool(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined
}

/**
 * 解析 SKILL.md 详情：frontmatter 扩展字段 + 正文全文。
 * 读失败 / YAML 坏 → null（行数据还在列表里，详情端点翻译为 410/404 语义）。
 * frontmatter 缺失的 skill（裸 markdown）合法：meta 全空 + 正文为全文。
 */
export function parseSkillDetail(path: string): ParsedSkillDetail | null {
    let content: string
    try {
        content = readFileSync(path, 'utf-8')
    } catch {
        return null
    }

    const split = splitSkillFrontmatter(content)
    // 与列表扫描的差异只有一处策略：未闭合围栏在详情里按「裸 markdown」处理（正文=全文），
    // YAML 坏才是真正的损坏（410）——格式切分本身归 scanner 单源
    if (split.kind === 'invalid') return null
    const front: Record<string, unknown> = split.kind === 'ok' ? split.front : {}
    const body = split.body

    const meta: SkillFrontmatterMeta = {
        whenToUse: asString(front.when_to_use),
        argumentHint: asString(front['argument-hint']),
        arguments: asStringList(front.arguments),
        userInvocable: asBool(front['user-invocable']),
        model: asString(front.model),
        effort: asString(front.effort),
        fork: front.context === 'fork' ? true : undefined,
        agent: asString(front.agent),
        background: asBool(front.background),
        paths: asStringList(front.paths),
        license: asString(front.license),
        compatibility: asString(front.compatibility),
    }
    return { body, meta }
}
