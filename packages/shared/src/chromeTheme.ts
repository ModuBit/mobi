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
 * 窗口 chrome 底色——**跨包共用的一个事实**，故落在 shared：
 *
 * 消费方三处，分属两包：daemon 拼 PWA manifest（`theme_color` / `background_color`，
 * 浏览器装入态用它给系统栏着色）、web 渲染 WCO 标题栏并写 `theme-color` meta、
 * web 的 index.html 首屏兜底（React 加载前）。
 *
 * 其中 daemon 只许依赖 shared（见 packages/daemon/CLAUDE.md 的依赖方向），够不着 web 的
 * 调色板；此前是 daemon 里手抄一份字面量 + 注释「记得一起改」，实测已经漂了
 * （2026-10-13：#fafafc 既不是容器色也不是画布色）。
 *
 * 值本身取自 web 的调色板（`packages/web/src/core/config/theme/tokens.ts`）：
 * light = 容器档、dark = 画布档——**chrome 必须与页面最外层表面同色**，否则系统栏与内容
 * 之间会裂出一道边。这条等式由 palette-consistency 守卫逐对断言，改配色时漏改这里会红。
 */

/** 双档 chrome 底色（档名与 web 的 ThemeProvider 一致） */
export const CHROME_BG = {
    /** 净白档（= 调色板的容器档） */
    light: '#f9f9fb',
    /** 净墨档（= 调色板的画布档） */
    dark: '#131316',
} as const

export type ChromeTheme = keyof typeof CHROME_BG
