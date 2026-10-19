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

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * 回归守卫：气泡布局类不得回退成 `.ant-bubble:has(...)`
 *
 * `:has()` 锚在 `.ant-bubble` 上时，流式每次 DOM 插入都会让浏览器重新判定该锚点，
 * 进而重算整个气泡子树——150 行表格实测单次 ~3400 元素 / 20–30ms，约 30% 帧掉出预算。
 * 布局语义改由数据侧显式声明类（buildBubbleItems.bubbleLayoutClass / HtmlInline effect），
 * 插入只影响新增节点。本测试扫描全部源码，禁止把规则写回 :has()。
 *
 * 允许其他元素上的 :has()（split-button、select、composer 等），只约束气泡锚点。
 */

const SRC = path.resolve(__dirname, '../src')

function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return walk(full)
        return /\.(css|ts|tsx)$/.test(entry.name) ? [full] : []
    })
}

/** 去注释：命中规则以被注释掉的说明文字为误报来源最烦人（本次改动就有一堆「不用 :has()」注释） */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
}

type Violation = { file: string; selector: string }

/**
 * 找出所有挂到 `.ant-bubble` 上的 :has()。
 *
 * 维持一个「开括号时的选择器栈」：命中 :has( 时，取最近一个 { } ; 之后的选择器片段；
 * 片段自身含 .ant-bubble → 违规；片段是 `&...` 嵌套（styled-components 模板）→
 * 看直接父选择器是否就是 .ant-bubble。
 */
function findBubbleHas(source: string): string[] {
    const found: string[] = []
    const stack: string[] = []
    let pending = ''
    for (let i = 0; i < source.length; i++) {
        const ch = source[i]
        if (ch === '{') {
            stack.push(pending.trim())
            pending = ''
            continue
        }
        if (ch === '}') {
            stack.pop()
            pending = ''
            continue
        }
        if (ch === ';') {
            pending = ''
            continue
        }
        if (ch === ':' && source.startsWith(':has(', i)) {
            const selector = pending.trim()
            const anchored = /\.ant-bubble\b/.test(selector) ||
                (/^&/.test(selector) && /\.ant-bubble\b/.test(stack[stack.length - 1] ?? ''))
            if (anchored) found.push(selector)
            pending += ':has('
            i += 4
            continue
        }
        pending += ch
    }
    return found
}

describe('气泡布局类守卫', () => {
    it('源码中不存在锚定在 .ant-bubble 上的 :has()', () => {
        const violations: Violation[] = []
        for (const file of walk(SRC)) {
            const source = stripComments(fs.readFileSync(file, 'utf8'))
            for (const selector of findBubbleHas(source)) {
                violations.push({ file: path.relative(SRC, file), selector })
            }
        }
        expect(violations).toEqual([])
    })

    it('替代类名在声明侧与规则侧都齐全（任一侧改名即静默塌布局）', () => {
        const antdCss = fs.readFileSync(path.join(SRC, 'styles/antd.css'), 'utf8')
        const items = fs.readFileSync(path.join(SRC, 'features/chat/buildBubbleItems.tsx'), 'utf8')
        const chatContainer = fs.readFileSync(path.join(SRC, 'pages/session/ChatContainer.tsx'), 'utf8')
        const htmlInline = fs.readFileSync(path.join(SRC, 'ui/shared/artifactInlineViews.tsx'), 'utf8')

        // buildBubbleItems 声明 → antd.css 消费（event-align 由模板拼出，按前缀对齐）
        for (const cls of ['bubble-has-tool', 'bubble-event-align-', 'bubble-turn-diff-fullwidth']) {
            expect(items).toContain(cls)
        }
        for (const cls of ['bubble-has-tool', 'bubble-event-align-left', 'bubble-event-align-right', 'bubble-turn-diff-fullwidth']) {
            expect(antdCss).toContain(cls)
        }
        // HtmlInline 在气泡根挂类 → antd.css 消费
        expect(htmlInline).toContain('bubble-artifact-fullwidth')
        expect(antdCss).toContain('bubble-artifact-fullwidth')
        // ChatContainer 的 spacer 项声明 → 同文件 CSS 规则消费
        expect(chatContainer).toContain('bubble-status-spacer')
        expect(chatContainer).toContain('.ant-bubble.bubble-status-spacer')
    })
})
