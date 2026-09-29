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
 * pierre 主题桥（审查重写票07，PoC 票01 验证姿势的工程化）：
 * 把 antd token 桥进 @pierre/diffs 的 Shadow DOM。
 *
 * 原理（PoC 实证，见 .scratch/review-render-rewrite/poc-report.md）：
 * pierre 基础样式的结构色走 `--diffs-light/dark-*` 双槽 + light-dark()；主题样式
 * 元素（:host 规则）写死的值可被 host 元素上的 inline 自定义属性覆盖（inline >
 * :host）——槽位兜底指到 antd CSS 变量（antd 变量经 :root 按主题注入，custom
 * property 天然穿透 Shadow DOM），单份声明跟随 light/dark 双档（主题纪律：双档
 * 各自有值，由 antd 变量按主题切换保证）。语法 token 色用 pierre 默认主题
 * （pierre-dark/pierre-light）。
 *
 * 用法：`<PatchDiff style={{ ...PIERRE_BRIDGE_VARS, height: '100%' }} .../>`。
 */

import { preloadHighlighter } from '@pierre/diffs'
import type { CSSProperties } from 'react'

/** host 元素 style 注入的桥接变量：前景/背景 + 增/删行基色（行背景由 color-mix 自基色派生） */
export const PIERRE_BRIDGE_VARS = {
    '--diffs-light': 'var(--ant-color-text)',
    '--diffs-dark': 'var(--ant-color-text)',
    '--diffs-light-bg': 'var(--ant-color-bg-container)',
    '--diffs-dark-bg': 'var(--ant-color-bg-container)',
    '--diffs-light-addition-color': 'var(--ant-color-success)',
    '--diffs-dark-addition-color': 'var(--ant-color-success)',
    '--diffs-light-deletion-color': 'var(--ant-color-error)',
    '--diffs-dark-deletion-color': 'var(--ant-color-error)',
} as CSSProperties

// 预热共享 highlighter（wasm + 默认双主题）：不预热时页面上首个 diff 实例的
// 首帧渲染会与 highlighter 异步初始化竞态，渲染出空壳（PoC 实证，重渲染才补上）。
// 模块加载即预热一次；失败静默（实例自身会兜底再拉）。
void preloadHighlighter({ themes: ['pierre-dark', 'pierre-light'], langs: ['typescript'] }).catch(() => {})
