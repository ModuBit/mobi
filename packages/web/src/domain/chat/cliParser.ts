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

/** 解析 CLI 输出文本，提取命令和输出 */
export function parseCliOutputText(text: string): { command: string | null, stdout: string | null, stderr: string | null } {
    // command-name / local-command-stdout 标签
    const commandMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/i)
    const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i)

    const command = commandMatch ? commandMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).trim() : null

    const stdout = stdoutMatch ? stdoutMatch[1].replace(/&#x[0-9A-Fa-f]+;/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    ).replace(/\x1B\[[0-9;]*m/g, '').trim() : null

    return { command, stdout, stderr: null }
}
