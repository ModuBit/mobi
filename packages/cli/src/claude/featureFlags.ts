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

import { configuration } from '@/configuration';

/** Claude Code agent teams 实验开关（由 claude 侧读取） */
export const CLAUDE_AGENT_TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';

/**
 * 任务工具开关（由 claude 侧读取）。SDK 0.3.233 / Claude Code 2.1.233 起
 * TaskCreate/TaskGet/TaskUpdate/TaskList/TodoWrite 在新模型（Opus 4.8 / Sonnet 5 及
 * 更新）默认移出工具面——这是上游按模型能力的刻意裁剪，mobi 跟随默认不注入；
 * 用户想要找回任务工具（TodoPanel / 任务面板展示），在 settings.json claudeEnv
 * 显式配 { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } 即可。
 */
export const CLAUDE_TODO_TOOLS_ENV = 'CLAUDE_CODE_ENABLE_TODO_TOOLS';

/**
 * buildClaudeFeatureEnv 的输入。可选——不传时从 configuration 单例读取默认值，
 * 调用点（claudeRemote / runClaude）无需改动；测试可显式传参做纯函数验证。
 */
export type ClaudeFeatureEnvOptions = {
    /** 是否启用 agent teams 内置快捷开关 */
    agentTeams?: boolean;
    /** settings.json 的 claudeEnv（用户自定义注入变量） */
    claudeEnv?: Record<string, string>;
};

/**
 * 把 mobi 侧的特性开关翻译成注入 claude 进程的环境变量。
 *
 * 这些变量由 claude 自己读取，mobi 只负责传递，因此集中在此处映射，
 * 避免变量名散落在各调用点。
 *
 * 优先级（从低到高）：
 *   1. 内置快捷开关（MOBI_AGENT_TEAMS → CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS）
 *   2. settings.json 的 claudeEnv（用户显式配置，最具体，覆盖同名内置开关）
 *
 * claudeEnv 由用户在 settings.json 编辑，需防御非对象 / 非 string 值，避免污染返回类型。
 */
export function buildClaudeFeatureEnv(opts?: ClaudeFeatureEnvOptions): Record<string, string> {
    const agentTeams = opts?.agentTeams ?? configuration.isAgentTeamsEnabled;
    const rawClaudeEnv = opts?.claudeEnv ?? configuration.claudeEnv;

    const env: Record<string, string> = {};

    if (agentTeams) {
        env[CLAUDE_AGENT_TEAMS_ENV] = '1';
    }

    // 用户在 settings.json 显式配置的 env，优先级最高
    // 注意：数组也是 object，须显式排除（否则 Object.entries 拿到数值键注入子进程）
    if (rawClaudeEnv && typeof rawClaudeEnv === 'object' && !Array.isArray(rawClaudeEnv)) {
        for (const [key, value] of Object.entries(rawClaudeEnv)) {
            if (typeof value === 'string') {
                env[key] = value;
            }
        }
    }

    return env;
}
