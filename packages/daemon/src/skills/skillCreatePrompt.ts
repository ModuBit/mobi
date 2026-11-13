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
 * 对话式新建 skill 的 prompt 生成（skill-mgmt 票 07）。
 *
 * 不做表单编辑器（Desktop/Codex 均无先例，已裁决对话式）：mobi 只负责
 * scope → 目标目录的权威映射（claudeConfigDir / workspace 路径 daemon 才有真值）
 * 与引导文本生成；SKILL.md 的编写由用户在会话里对话完成，落盘后经列表刷新可见
 * （untracked 真目录形态）。
 */
/**
 * 预填 prompt：目标目录绝对路径 + SKILL.md 基本结构引导 + 完成后回管理页可见的提示。
 * 目录已存在时不覆盖（同名防御写进引导）。
 */
export function buildSkillCreatePrompt(targetDir: string): string {
    return [
        `请帮我创建一个新的 Claude Code skill，保存到：${targetDir}/<技能名>/SKILL.md`,
        '',
        '要求：',
        `1. 先和我确认技能的用途与名字（技能名用小写字母和连字符，如 my-skill），目录建在 ${targetDir} 下`,
        '2. SKILL.md 使用 YAML frontmatter 开头，至少包含 name 和 description 两个字段：',
        '   ---',
        '   name: my-skill',
        '   description: 一句话说明这个技能什么时候用（这段会进系统提示词，写清触发场景）',
        '   ---',
        '3. 正文是这个技能被调用时给 Claude 的操作指引：步骤、约束、示例都写在这里',
        '4. 若目录已存在同名技能，先展示现有内容再问我要不要覆盖，不要直接覆盖',
        '',
        `完成后告诉我保存的完整路径。之后回到 mobi 设置页的 Skills 分区即可看到并管理它。`,
    ].join('\n')
}
