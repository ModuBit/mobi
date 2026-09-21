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
 * Markdown 渲染器运行时开关（Streamdown 迁移期双栈分发）
 *
 * 迁移期间 Markdown 组件内部按此 flag 分发新旧双栈（x-markdown ↔ Streamdown）：
 * - 默认旧栈（x-markdown），localStorage 持久化，重载页面生效
 * - 设置页调试区块提供切换入口（见 DebugSection）
 * - 性能 gate（ticket 09）达标且用户确认后随 ticket 10 连同双栈分发一起移除
 *
 * 任何环境缺失 localStorage 都静默降级为「旧栈」，绝不抛错（同 debug.ts 约定）。
 */

const LS_RENDERER_KEY = 'mobi-md-renderer'

/** 渲染器标识：x-markdown（旧栈，默认）/ streamdown（新栈，实验） */
export type MarkdownRenderer = 'x-markdown' | 'streamdown'

/** 读 localStorage 安全访问器（同 debug.ts getStore，任何环境缺失 localStorage 都降级返回 null） */
function getStore(): Storage | null {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
    } catch {
        return null
    }
}

/** 当前生效的渲染器（未设置 / 值非法时返回旧栈） */
export function getMarkdownRenderer(): MarkdownRenderer {
    return getStore()?.getItem(LS_RENDERER_KEY) === 'streamdown' ? 'streamdown' : 'x-markdown'
}

/** 切换渲染器（持久化；重载页面后生效。切回旧栈时清除 key，保持 localStorage 干净） */
export function setMarkdownRenderer(renderer: MarkdownRenderer): void {
    try {
        if (renderer === 'streamdown') {
            getStore()?.setItem(LS_RENDERER_KEY, 'streamdown')
        } else {
            getStore()?.removeItem(LS_RENDERER_KEY)
        }
    } catch {
        // localStorage 满 / 隐私模式：忽略，本次会话内由调用方自行决定是否提示
    }
}

/** 是否启用 Streamdown 新栈（Markdown 双栈分发用，调用点每渲染读一次，成本可忽略） */
export function isStreamdownEnabled(): boolean {
    return getMarkdownRenderer() === 'streamdown'
}
