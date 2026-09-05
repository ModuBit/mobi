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
 * settings.json 文件监听器 —— 仅热 reload webApiToken
 *
 * 设计要点：
 * - fs.watch 底层是内核事件（inotify/FSEvents/RDCW），事件驱动、非轮询，开销可忽略。
 * - 监听父目录并按文件名过滤：原子保存（tmp + rename）在 macOS FSEvents 下对
 *   单文件 watch 会丢事件/发陈旧内容；目录级 watch 能可靠捕获 rename。
 * - debounce（100ms）吞掉一次写入触发的多次回调（tmp 创建 + rename）。
 * - 只 diff webApiToken 字段：其他字段变化不触发 reload，避免误重载无关配置。
 */

import { watch, type FSWatcher } from 'node:fs'
import { dirname, basename } from 'node:path'
import { configuration, getConfiguration } from '../configuration'
import { hubLogger } from '../logger'
import { readSettings } from './settings'

const DEBOUNCE_MS = 100

export interface SettingsWatcher {
    stop(): void
}

export function startWebApiTokenWatcher(): SettingsWatcher {
    const settingsFile = configuration.settingsFile
    const dir = dirname(settingsFile)
    const file = basename(settingsFile)
    let lastWebToken = configuration.webApiToken
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let watcher: FSWatcher | null = null
    let stopped = false

    const reloadIfChanged = () => {
        if (stopped) return
        readSettings(settingsFile)
            .then((settings) => {
                if (stopped) return
                const next = settings?.webApiToken
                if (next && next !== lastWebToken) {
                    // 通过 getConfiguration() 拿到真实单例再调方法；
                    // configuration 是 Proxy（仅拦截 get），直接调方法会以 Proxy 为 this，
                    // 赋值落到 Proxy 的空 target 上而非真实单例。
                    // source 固定为 'file'：watcher 只在检测到文件变化时触发，
                    // 此时值的来源就是文件（无论启动时是 env 还是 generated）
                    getConfiguration()._setWebApiToken(next, 'file', false)
                    lastWebToken = next
                    hubLogger.info('[Hub] webApiToken reloaded from settings.hub.json')
                }
            })
            .catch(() => {
                // 读取失败：保留现状，等下一次事件重试
            })
    }

    const schedule = () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(reloadIfChanged, DEBOUNCE_MS)
    }

    try {
        watcher = watch(dir, (eventType, filename) => {
            // macOS FSEvents 的 rename 事件报告的是源文件名（settings.json.tmp），
            // 而非目标文件名（settings.json），无法按 settings.json 精确过滤。
            // rename 事件在 dataDir 中极少发生（SQLite WAL 模式用 write 不用 rename），
            // 即使误触发，reloadIfChanged 的 diff 检查会过滤掉无关变更。
            if (eventType === 'rename' || filename === file) {
                schedule()
            }
        })
        watcher.on('error', () => {
            // FSEvents/inotify 极少出错；出错时 watcher 会自动关闭，无需特殊处理
        })
        // 注册后立即检查一次：追赶 createConfiguration 快照与 watch 注册之间
        // （hub 启动期间）可能发生的文件变更，避免轮换静默丢失
        reloadIfChanged()
    } catch {
        // 目录不存在等极端情况：无法监听，静默放弃
        // （正常启动流程下 createConfiguration 已确保 dataDir 存在）
    }

    return {
        stop() {
            stopped = true
            if (debounceTimer) clearTimeout(debounceTimer)
            watcher?.close()
        }
    }
}
