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
 * 命令使用统计（按 workingDir 绑定）
 * 使用 localStorage 存储
 */

const STORAGE_KEY = 'mobi:commandUsage'

type UsageMap = Record<string, Record<string, { count: number; lastUsedAt: number }>>

function loadUsage(): UsageMap {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) return {}
        return JSON.parse(stored) as UsageMap
    } catch {
        return {}
    }
}

function saveUsage(usage: UsageMap): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
    } catch {
        // 忽略存储错误
    }
}

/** 记录一次命令使用 */
export function recordCommandUsage(workingDir: string, commandName: string): void {
    const usage = loadUsage()
    const dirUsage = usage[workingDir] ?? {}
    const entry = dirUsage[commandName]
    const now = Date.now()

    dirUsage[commandName] = entry
        ? { count: entry.count + 1, lastUsedAt: now }
        : { count: 1, lastUsedAt: now }

    usage[workingDir] = dirUsage
    saveUsage(usage)
}

/**
 * 一次性加载使用数据，返回按分数降序排序的命令名列表
 * 综合最近使用时间（7天半衰期）和使用频率（log 衰减）
 */
export function getCommandsOrderByScore(workingDir: string, commandNames: string[]): string[] {
    const dirUsage = loadUsage()[workingDir]
    if (!dirUsage) return commandNames

    const now = Date.now()

    const scored = commandNames.map(name => {
        const entry = dirUsage[name]
        if (!entry) return { name, score: 0 }

        const ageHours = (now - entry.lastUsedAt) / 3_600_000
        const recency = Math.max(0, 100 - ageHours * (100 / 168))
        const frequency = Math.log2(entry.count + 1) * 10

        return { name, score: recency + frequency }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.map(s => s.name)
}
