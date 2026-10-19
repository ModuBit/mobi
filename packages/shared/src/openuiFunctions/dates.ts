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
 * 日期类 @函数（8 个）：当前时间、格式化、加减天/月、日数与月数差、周期起点。
 * 来源：thesysdev/open-intelligent-ui（MIT）`src/lib/functions/dates.ts`。
 *
 * 语义要点（上游注释）：`"YYYY-MM-DD"` 是无时区的日历日；时间戳或 ISO 日期时间
 * 按查看者时区读取。纯日历日格式化时固定用 UTC，避免日期随用户时区漂移。
 */

import { defineFunction } from '@openuidev/lang-core'
import { z } from 'zod'
import { date } from './shared'

const DAY = 86_400_000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** 一个日期：日历日（自 1970-01-01 起的天数）+ 时间戳形态下的时刻 */
type Parsed = { day: number; instant: Date | null }

export function parseDate(value: string | number): Parsed {
    if (typeof value === 'string') {
        const m = DATE_ONLY.exec(value.trim())
        if (m) {
            const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
            const utc = Date.UTC(y, mo - 1, d)
            const check = new Date(utc)
            // 归一化后回读校验：拒绝 2026-02-31 这类「看起来合法」的日期
            if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new Error(`invalid date "${value}"`)
            return { day: utc / DAY, instant: null }
        }
    }
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) throw new Error(`invalid date "${value}"`)
    return { day: Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()) / DAY, instant }
}

export function isoDay(day: number): string {
    return new Date(day * DAY).toISOString().slice(0, 10)
}

const STYLES: Record<string, Intl.DateTimeFormatOptions> = {
    date: { month: 'short', day: 'numeric', year: 'numeric' },
    short: { month: 'short', day: 'numeric' },
    long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    weekday: { weekday: 'short' },
    month: { month: 'short', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' },
    datetime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}

export const Now = defineFunction({
    name: 'Now',
    description: 'The current date and time as an ISO string',
    params: z.object({}),
    returns: z.string(),
    fn: () => new Date().toISOString(),
})

export const FormatDate = defineFunction({
    name: 'FormatDate',
    description:
        'A date as text: "date" Oct 9, 2026 (default), "short" Oct 9, "long" Friday, October 9, 2026, "weekday" Fri, "month" Oct 2026, "time" 9:30 PM, "datetime", "iso" 2026-10-09. Dates are "YYYY-MM-DD", ISO or a timestamp',
    params: z.object({
        date: date(),
        style: z
            .enum(['date', 'short', 'long', 'weekday', 'month', 'time', 'datetime', 'iso'])
            .optional(),
    }),
    returns: z.string(),
    fn: ({ date, style = 'date' }) => {
        const { day, instant } = parseDate(date)
        if (style === 'iso') return isoDay(day)
        // 纯日历日按 UTC 格式化，日期不随查看者时区偏移
        const at = instant ?? new Date(day * DAY)
        return at.toLocaleString('en-US', { ...STYLES[style], ...(instant ? {} : { timeZone: 'UTC' }) })
    },
})

export const AddDays = defineFunction({
    name: 'AddDays',
    description: 'The date days later (negative: earlier), as "YYYY-MM-DD"',
    params: z.object({ date: date(), days: z.number() }),
    returns: z.string(),
    fn: ({ date, days }) => isoDay(parseDate(date).day + Math.trunc(days)),
})

export const DaysBetween = defineFunction({
    name: 'DaysBetween',
    description: 'Calendar days from one date to another (negative if to is earlier)',
    params: z.object({ from: date(), to: date() }),
    returns: z.number(),
    fn: ({ from, to }) => parseDate(to).day - parseDate(from).day,
})

export const Today = defineFunction({
    name: 'Today',
    description: 'Today\'s date in the viewer\'s time zone, as "YYYY-MM-DD"',
    params: z.object({}),
    returns: z.string(),
    fn: () => isoDay(parseDate(Date.now()).day),
})

/** 日历日的年、月（0-11）、日 */
function ymd(day: number): [number, number, number] {
    const d = new Date(day * DAY)
    return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]
}

export const AddMonths = defineFunction({
    name: 'AddMonths',
    description:
        'The date months later (negative: earlier), kept within the month (Jan 31 + 1 is Feb 28), as "YYYY-MM-DD"; 12 months is a year',
    params: z.object({ date: date(), months: z.number() }),
    returns: z.string(),
    fn: ({ date, months }) => {
        const [y, m, d] = ymd(parseDate(date).day)
        const target = m + Math.trunc(months)
        const last = new Date(Date.UTC(y, target + 1, 0)).getUTCDate()
        return isoDay(Date.UTC(y, target, Math.min(d, last)) / DAY)
    },
})

export const MonthsBetween = defineFunction({
    name: 'MonthsBetween',
    description:
        'Whole months from one date to another (negative if to is earlier); @Floor(@MonthsBetween(birthday, @Today()) / 12) is an age',
    params: z.object({ from: date(), to: date() }),
    returns: z.number(),
    fn: ({ from, to }) => {
        const [y1, m1, d1] = ymd(parseDate(from).day)
        const [y2, m2, d2] = ymd(parseDate(to).day)
        let months = (y2 - y1) * 12 + (m2 - m1)
        if (months > 0 && d2 < d1) months -= 1
        if (months < 0 && d2 > d1) months += 1
        return months
    },
})

export const StartOf = defineFunction({
    name: 'StartOf',
    description: 'First day of the date\'s "week" (Monday), "month" or "year", as "YYYY-MM-DD"',
    params: z.object({ date: date(), unit: z.enum(['week', 'month', 'year']) }),
    returns: z.string(),
    fn: ({ date, unit }) => {
        const day = parseDate(date).day
        const [y, m] = ymd(day)
        if (unit === 'week') return isoDay(day - ((new Date(day * DAY).getUTCDay() + 6) % 7))
        return isoDay(Date.UTC(y, unit === 'month' ? m : 0, 1) / DAY)
    },
})

export const dateFunctions = [Now, Today, FormatDate, AddDays, AddMonths, DaysBetween, MonthsBetween, StartOf]
