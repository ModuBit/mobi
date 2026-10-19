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
 * Chart 组件签名（票 03 移植）——只含生成端协议（name/props/description），
 * 不含 React 实现。web 渲染器与 session prompt 生成器共用这一份 schema：
 * 前者 defineComponent 时挂上实现，后者只需签名（渲染不到）。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/components/chart.tsx`
 * （MIT，完整许可声明见本目录 index.ts）。
 */

import { z } from 'zod'

export const chartProps = z.object({
    type: z.enum(['bar', 'line', 'area', 'pie', 'donut', 'scatter']),
    data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    x: z.string().optional(),
    series: z.array(z.string()).optional(),
    format: z.enum(['number', 'currency', 'percent']).optional(),
    currency: z.string().optional(),
    stacked: z.boolean().optional(),
    height: z.number().optional(),
})

export const chartComponentSpec = {
    name: 'Chart',
    props: chartProps,
    description:
        'Rows of data; x is the category key (a number key for scatter), series the value keys (default: every number key). percent values are like 45; currency is a code like "EUR".',
} as const
