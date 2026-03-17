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
 * 格式化相对时间
 * @param timestamp 时间戳（毫秒）
 * @returns 相对时间字符串，如 "3分钟前"、"2小时前"、"3天前"
 */
export function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const week = 7 * day
    const month = 30 * day
    const year = 365 * day

    if (diff < minute) {
        return '刚刚'
    } else if (diff < hour) {
        const minutes = Math.floor(diff / minute)
        return `${minutes}分钟前`
    } else if (diff < day) {
        const hours = Math.floor(diff / hour)
        return `${hours}小时前`
    } else if (diff < week) {
        const days = Math.floor(diff / day)
        return `${days}天前`
    } else if (diff < month) {
        const weeks = Math.floor(diff / week)
        return `${weeks}周前`
    } else if (diff < year) {
        const months = Math.floor(diff / month)
        return `${months}个月前`
    } else {
        const years = Math.floor(diff / year)
        return `${years}年前`
    }
}
