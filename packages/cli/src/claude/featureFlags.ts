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
 * 把 mobi 侧的特性开关翻译成注入 claude 进程的环境变量。
 *
 * 这些变量由 claude 自己读取，mobi 只负责传递，因此集中在此处映射，
 * 避免变量名散落在各调用点。仅包含已开启的开关——未开启时不写入，
 * 保持 claude 的默认行为。
 */
export function buildClaudeFeatureEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    if (configuration.isAgentTeamsEnabled) {
        env[CLAUDE_AGENT_TEAMS_ENV] = '1';
    }

    return env;
}
