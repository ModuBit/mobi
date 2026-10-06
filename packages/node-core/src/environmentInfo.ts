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
 * 环境信息快照（debug 用）。
 *
 * ticket-12 从 cli ui/doctor 抽出归 node-core：daemon 与 claude 会话
 * （session）启动时都要把它注入 machine metadata / SDK env；cli 的 doctor 命令
 * 同样复用。ui/doctor 保留 re-export。
 */

import { configuration } from './configuration';

/**
 * Get relevant environment information for debugging
 */
export function getEnvironmentInfo(): Record<string, string | number | boolean | string[] | undefined> {
    return {
        PWD: process.env.PWD,
        MOBI_HOME: process.env.MOBI_HOME,
        MOBI_API_URL: process.env.MOBI_API_URL,
        MOBI_PROJECT_ROOT: process.env.MOBI_PROJECT_ROOT,
        CLI_API_TOKEN_SET: Boolean(process.env.CLI_API_TOKEN),
        DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: process.env.DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING,
        NODE_ENV: process.env.NODE_ENV,
        DEBUG: process.env.DEBUG,
        workingDirectory: process.cwd(),
        processArgv: process.argv,
        mobiHomeDir: configuration?.mobiHomeDir,
        apiUrl: configuration?.apiUrl,
        logsDir: configuration?.logsDir,
        processPid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        user: process.env.USER,
        home: process.env.HOME,
        shell: process.env.SHELL,
        terminal: process.env.TERM,
    };
}
