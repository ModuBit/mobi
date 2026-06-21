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

/** 常见扩展名 → mime；未命中返回 application/octet-stream */
const MIME_BY_EXTENSION: Record<string, string> = {
    // 文本/代码
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
    json: 'application/json', yml: 'text/yaml', yaml: 'text/yaml',
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
    ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript',
    py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust',
    java: 'text/x-java', kt: 'text/x-kotlin', c: 'text/x-c', h: 'text/x-c',
    cpp: 'text/x-c++', cc: 'text/x-c++', hpp: 'text/x-c++',
    sh: 'application/x-sh', bash: 'application/x-sh', zsh: 'application/x-sh',
    sql: 'application/sql', xml: 'application/xml', toml: 'application/toml',
    ini: 'text/plain', conf: 'text/plain', log: 'text/plain', csv: 'text/csv',
    // 图片
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
    // 音视频
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    m4a: 'audio/mp4', aac: 'audio/aac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    // 文档
    pdf: 'application/pdf',
}

/** 按扩展名查 mime，未命中返回 application/octet-stream */
export function lookupMime(filename: string): string {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}
