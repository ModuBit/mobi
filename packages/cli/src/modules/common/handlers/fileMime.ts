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
    // 前端组件/DSL（选 text/* 让 web FileContentView isTextLike 命中预览）
    vue: 'text/x-vue', svelte: 'text/x-svelte', astro: 'text/x-astro',
    // 其他常见源码/配置语言
    dart: 'text/x-dart', lua: 'text/x-lua', r: 'text/x-r', scala: 'text/x-scala',
    clj: 'text/x-clojure', cljs: 'text/x-clojure', edn: 'text/x-clojure',
    hs: 'text/x-haskell', swift: 'text/x-swift', kts: 'text/x-kotlin',
    nim: 'text/x-nim', zig: 'text/x-zig', v: 'text/x-v', elm: 'text/x-elm',
    ex: 'text/x-elixir', exs: 'text/x-elixir', erl: 'text/x-erlang',
    ml: 'text/x-ocaml', fs: 'text/x-fsharp', pl: 'text/x-perl', php: 'application/x-php',
    proto: 'text/x-protobuf', graphql: 'application/graphql', gql: 'application/graphql',
    gradle: 'text/x-groovy', groovy: 'text/x-groovy',
    tf: 'text/x-hcl', hcl: 'text/x-hcl',
    cmake: 'text/x-cmake', makefile: 'text/x-makefile',
    dockerfile: 'text/x-dockerfile',
    // 图片
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', tiff: 'image/tiff', tif: 'image/tiff',
    // 音视频
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    m4a: 'audio/mp4', aac: 'audio/aac',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    // 字体（web font / 字体图标）
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
    otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    // 文档
    pdf: 'application/pdf',
}

/** 按扩展名查 mime，未命中返回 application/octet-stream */
export function lookupMime(filename: string): string {
    const dotIndex = filename.lastIndexOf('.')
    // 无 "."（纯文件名，如 README/Makefile）或 "." 在末尾（"foo."）→ 无有效扩展名，
    // 直接返回 octet-stream，避免 slice(0) 取整个文件名误匹配（如纯文件名 "json" 被当成 .json）
    if (dotIndex < 0 || dotIndex >= filename.length - 1) {
        return 'application/octet-stream'
    }
    const ext = filename.slice(dotIndex + 1).toLowerCase()
    return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}
