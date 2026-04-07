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

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 根据 workingDirectory 获取 Claude 项目配置目录路径。
 *
 * 将工作目录的绝对路径转换为安全的目录名：
 * - 先通过 resolve() 获取绝对路径
 * - 再将所有非字母数字字符替换为 '-'，生成合法的 projectId
 *
 * 例如：/home/user/my-project → home-user-my-project
 * 最终返回：~/.claude/projects/home-user-my-project
 */
export function getProjectPath(workingDirectory: string) {
    // 将绝对路径转换为安全的目录名（仅保留字母数字，其余替换为 '-'）
    const projectId = resolve(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects', projectId);
}