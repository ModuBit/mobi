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

const BASH_TAGS_REGEX = /<bash-(?:input|stdout|stderr)>/i

/** 检测文本是否包含 bash 标签 */
export function hasBashTags(text: string): boolean {
    return BASH_TAGS_REGEX.test(text)
}

/** 解析 CLI 输出文本，提取命令和输出 */
export function parseCliOutputText(text: string): { command: string | null, stdout: string | null, stderr: string | null } {
    // bash-input / bash-stdout / bash-stderr 标签
    const bashInputMatch = text.match(/<bash-input>([\s\S]*?)<\/bash-input>/i)
    const bashStdoutMatch = text.match(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/i)
    const bashStderrMatch = text.match(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/i)

    if (bashInputMatch) {
        return {
            command: `$ ${bashInputMatch[1].trim()}`,
            stdout: bashStdoutMatch ? bashStdoutMatch[1].trim() : null,
            stderr: bashStderrMatch ? bashStderrMatch[1].trim() : null,
        }
    }

    // 兼容原有 command-name / local-command-stdout 标签
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
