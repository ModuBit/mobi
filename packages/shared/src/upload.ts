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
 * 文件上传共享常量
 *
 * 上传文件类型限制与大小上限的单一数据源，供 CLI、Hub、Web 三端共用。
 */

/** 允许上传的文件扩展名（白名单） */
export const ALLOWED_EXTENSIONS = [
    // 图片
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif',
    // 文档
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.md', '.csv', '.rtf', '.odt', '.ods', '.odp',
    // 代码
    '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
    '.dart', '.lua', '.r',
    '.html', '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml',
    '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
    '.env', '.properties', '.gradle', '.cmake',
    '.sql', '.graphql', '.proto', '.dockerfile',
    '.vue', '.svelte', '.astro',
    // 音频
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
    // 视频
    '.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv',
    // 压缩包
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
] as const

/** 禁止上传的文件扩展名（黑名单，优先于白名单） */
export const BLOCKED_EXTENSIONS = [
    // Windows 可执行文件
    '.exe', '.bat', '.cmd', '.msi', '.com', '.scr',
    // 动态链接库
    '.dll', '.so', '.dylib',
    // macOS
    '.app', '.dmg',
    // Linux 包
    '.deb', '.rpm',
    // 光盘映像
    '.iso',
] as const

/** 允许上传的文件扩展名 Set（运行时查找用） */
export const ALLOWED_EXTENSIONS_SET = new Set<string>(ALLOWED_EXTENSIONS)

/** 禁止上传的文件扩展名 Set（运行时查找用） */
export const BLOCKED_EXTENSIONS_SET = new Set<string>(BLOCKED_EXTENSIONS)

/** 最大上传文件大小：50MB */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
