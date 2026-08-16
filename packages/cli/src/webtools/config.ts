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
 * web 工具配置的 mtime 惰性读取（read-through cache）。
 *
 * 生效机制 = 文件系统即广播：runner 落盘 settings.json 后，任何会话进程的
 * 下一次 web 工具调用 statSync 检查 mtime、变了才重读 → 热更新零通知零协调。
 * 不用 FSWatcher：原子写是 tmp+rename 换 inode，Linux inotify 会盯旧 inode 静默失效。
 */
import { statSync, readFileSync, existsSync } from 'node:fs'
import { WebToolsConfigSchema, normalizeWebToolsConfig, type WebToolsConfig } from '@mobi/shared'
import { configuration } from '@/configuration'

let cache: { file: string; mtimeMs: number; config: WebToolsConfig } | null = null

/**
 * 读取 web 工具配置（默认 ~/.mobi/settings.json）。mtime 未变走缓存。
 *
 * 边界兜底：文件不存在 → 空配置；读取/解析/校验失败 → 沿用上一次缓存值
 * （从未成功读过则空配置）——坏配置不该把工具打挂。
 */
export function readWebToolsConfig(file: string = configuration.settingsFile): WebToolsConfig {
    let mtimeMs: number
    try {
        mtimeMs = statSync(file).mtimeMs
    } catch {
        // 文件不存在（首次未配置）→ 空配置
        return WebToolsConfigSchema.parse({})
    }
    if (cache && cache.file === file && cache.mtimeMs === mtimeMs) {
        return cache.config
    }
    if (!existsSync(file)) {
        // stat 与 exists 之间文件被删（竞态窗口）→ 同"文件不存在"语义
        return WebToolsConfigSchema.parse({})
    }
    try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { webTools?: unknown }
        // 存量归一：残留已下线 provider 条目剔除（合法配置不被连坐成空），不抛错
        const config = normalizeWebToolsConfig(raw.webTools)
        cache = { file, mtimeMs, config }
        return config
    } catch {
        // 解析失败（文件损坏）→ 沿用该文件上一次缓存，避免坏文件把工具打挂；
        // 缓存属于别的文件（多文件场景）则不能拿来兜底，退回空配置
        return cache?.file === file ? cache.config : WebToolsConfigSchema.parse({})
    }
}

/** 测试专用：清空缓存 */
export function __resetWebToolsConfigCache(): void {
    cache = null
}
