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
 * XMarkdown 调试面板（FPS / Memory / Record）的开关。
 *
 * 此前绑定 import.meta.env.DEV——dev 模式每个 markdown 块都渲染调试面板且
 * fixed 定位叠在视口右上角，污染 dev 自测与设计走查。改为显式开关（模式同
 * diag.ts）：调试能力保留，默认不脏画面。
 *
 * 开启（一次性入口）：URL 加 `?xmd-debug=1` → 写入 localStorage 常驻
 * 关闭：URL 加 `?xmd-debug=0`
 *
 * 仅 dev 环境生效（生产构建 XMarkdown debug 面板无意义，保持恒关）。
 */

const LS_ENABLED_KEY = 'mobi-xmd-debug-enabled'

/** 模块级缓存：入口 init 时解析，渲染期每块 markdown 读变量而非 localStorage */
let enabled = false

/** 应用入口调用：解析 ?xmd-debug=1/0 一次性入口，落 localStorage 并刷新缓存 */
export function initXMarkdownDebugFromQuery(): void {
    const value = new URLSearchParams(window.location.search).get('xmd-debug')
    if (value === '1') localStorage.setItem(LS_ENABLED_KEY, '1')
    if (value === '0') localStorage.removeItem(LS_ENABLED_KEY)
    enabled = localStorage.getItem(LS_ENABLED_KEY) === '1'
}

/** dev 下是否开启调试面板（生产恒 false） */
export function isXMarkdownDebugEnabled(): boolean {
    return import.meta.env.DEV && enabled
}
