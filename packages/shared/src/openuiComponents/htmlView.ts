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
 * HtmlView 组件签名（票 03 移植）——沙箱 iframe 里的整页 HTML，只用于
 * canvas / 小游戏这类用组件拼不出来的内联交互（重逻辑仍是 mode="app"）。
 *
 * 来源：https://github.com/thesysdev/open-intelligent-ui `src/lib/components/html-view.tsx`
 * （MIT，完整许可声明见本目录 index.ts）。
 */

import { z } from 'zod'

export const htmlViewComponentSpec = {
    name: 'HtmlView',
    props: z.object({
        html: z.string(),
        height: z.number().optional(),
        title: z.string().optional(),
    }),
    description: 'Sandboxed HTML page with inline JS, for games and canvas. No network except script CDNs. Fits its content unless height is set.',
} as const
