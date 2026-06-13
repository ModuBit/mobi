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

/** i18n t 函数类型（避免引入 react-i18next 依赖） */
type TFunction = (key: string, options?: Record<string, unknown>) => string

/**
 * 格式化相对时间（国际化版本）
 * @param timestamp 时间戳（毫秒）
 * @param t i18n 翻译函数
 * @returns 相对时间字符串，如 "3分钟前"、"2小时前"、"3天前"
 */
export function formatRelativeTime(timestamp: number, t?: TFunction): string {
    const now = Date.now()
    const diff = now - timestamp

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const week = 7 * day
    const month = 30 * day
    const year = 365 * day

    // 无 t 函数时 fallback 到中文（兼容已有调用方）
    if (!t) {
        if (diff < minute) return '刚刚'
        if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
        if (diff < day) return `${Math.floor(diff / hour)}小时前`
        if (diff < week) return `${Math.floor(diff / day)}天前`
        if (diff < month) return `${Math.floor(diff / week)}周前`
        if (diff < year) return `${Math.floor(diff / month)}个月前`
        return `${Math.floor(diff / year)}年前`
    }

    if (diff < minute) {
        return t('time.justNow')
    } else if (diff < hour) {
        return t('time.minutesAgo', { count: Math.floor(diff / minute) })
    } else if (diff < day) {
        return t('time.hoursAgo', { count: Math.floor(diff / hour) })
    } else if (diff < week) {
        return t('time.daysAgo', { count: Math.floor(diff / day) })
    } else if (diff < month) {
        return t('time.weeksAgo', { count: Math.floor(diff / week) })
    } else if (diff < year) {
        return t('time.monthsAgo', { count: Math.floor(diff / month) })
    } else {
        return t('time.yearsAgo', { count: Math.floor(diff / year) })
    }
}

/**
 * 格式化运行时长
 * @param startedAt 开始时间戳（毫秒）
 * @param now 当前时间戳（毫秒），默认 Date.now()
 * @returns 格式化时长，如 "34s"、"2m 12s"、"1h 12m 58s"
 */
export function formatElapsedTime(startedAt: number, now: number = Date.now()): string {
    const diffMs = Math.max(0, now - startedAt)
    const totalSeconds = Math.floor(diffMs / 1000)

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
}

/** 格式化消息时间：当天 HH:mm，非当天 MM/DD HH:mm，非当年 YYYY/MM/DD HH:mm */
export function formatMessageTime(createdAt: number): string {
    const date = new Date(createdAt)
    const now = new Date()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const time = `${hours}:${minutes}`

    const sameYear = date.getFullYear() === now.getFullYear()
    const sameMonth = sameYear && date.getMonth() === now.getMonth()
    const sameDay = sameMonth && date.getDate() === now.getDate()

    if (sameDay) return time
    const monthDay = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`
    if (sameYear) return `${monthDay} ${time}`
    return `${date.getFullYear()}/${monthDay} ${time}`
}
