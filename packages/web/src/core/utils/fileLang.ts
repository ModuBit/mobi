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

/** 扩展名/别名 → Shiki canonical 语言名；未命中 → 'text'（纯文本不高亮） */
const LANG_ALIAS: Record<string, string> = {
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    shell: 'shellscript',
    ps1: 'shellscript',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    jsx: 'jsx',
    tsx: 'tsx',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    html: 'html',
    htm: 'html',
    svg: 'xml',
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',
    md: 'markdown',
    markdown: 'markdown',
    css: 'css',
    scss: 'css',
    sql: 'sql',
    c: 'c',
    h: 'c',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    py: 'python',
    php: 'php',
    swift: 'swift',
    cs: 'csharp',
    dockerfile: 'dockerfile',
    diff: 'diff',
    patch: 'diff',
}

/** 从文件路径提取扩展名 → Shiki 语言；未命中返回 'text'（纯文本不高亮） */
export function resolveFileLang(filePath: string): string {
    // 取最后一段文件名（去目录），Dockerfile 无扩展名需特殊处理
    const base = filePath.slice(filePath.lastIndexOf('/') + 1)
    const lower = base.toLowerCase()
    if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
    // 取最后一个 . 后的部分作为扩展名
    const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase()
    // 无扩展名（如 README）或 . 开头的 dotfile（如 .bashrc）→ text
    if (!ext || ext === base) return 'text'
    return LANG_ALIAS[ext] ?? 'text'
}
