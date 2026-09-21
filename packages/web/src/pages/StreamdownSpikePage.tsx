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

/** Streamdown 体验页（spike，临时）：A/B 对比 Streamdown 与现行 XMarkdown 的流式渲染 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import '@/styles/streamdown-spike.css'
import { Markdown } from '@/components/ui/Markdown'
import { StreamdownView } from '@/components/ui/StreamdownView'
import { useStreamingContent } from '@/components/ui/useStreamingContent'
import { useIsDark } from '@/core/data/hooks/useIsDark'

/** 演示样本：覆盖中文强调/autolink、未闭合粗体、代码、表格、公式、mermaid、任务列表 */
const SAMPLE = [
    '## Streamdown 体验',
    '',
    '中文强调修复：**这是加粗（括号结尾）。**后面继续普通文字，autolink 不吞句号：详见 https://example.com。这是链接。',
    '',
    '行内代码 `bun run dev`，流式中的未闭合语法也应即渲染：**这段粗体边流边显示**',
    '',
    '```ts',
    'interface User { id: number; name: string }',
    'export async function fetchUser(id: number): Promise<User> {',
    '  const res = await fetch(`/api/users/${id}`)',
    '  if (!res.ok) throw new Error(\'not found\')',
    '  return res.json()',
    '}',
    '```',
    '',
    '| 特性 | 现行 XMarkdown | Streamdown |',
    '|---|---|---|',
    '| 块级 memo | ❌ | ✅ |',
    '| 未闭合补全 | 仅围栏 | 全语法 |',
    '| 中文强调修复 | ❌ | ✅ |',
    '',
    '公式：质能方程 $$E = mc^2$$，行内 $$a^2 + b^2 = c^2$$ 也支持。',
    '',
    '```mermaid',
    'graph LR',
    'A[流式输入] --> B{块级 memo}',
    'B -->|命中| C[跳过重渲染]',
    'B -->|未命中| D[解析该块]',
    'D --> E[动画挂 span]',
    '```',
    '',
    '- [x] 逐字淡入',
    '- [ ] 你来评价效果',
    '',
].join('\n')

/** 每帧追加的字符数区间：突发式到达（一次一批 6-14 字符、间隔 250-450ms）
 *  贴近真实 LLM SSE 节奏——成批到达才会呈现 playground 那样的级联波浪，
 *  匀速逐字滴灌时每帧只有一个 span 在动画，观感差异极大 */
const CHUNK_MIN = 6
const CHUNK_MAX = 14
const CHUNK_INTERVAL_MS = 250
const CHUNK_JITTER_MS = 200

export function StreamdownSpikePage() {
    const isDark = useIsDark()
    const [visibleLen, setVisibleLen] = useState(0)

    // setTimeout 链逐帧推进揭示长度（随机步长模拟 token 抖动），到尾自然停止
    useEffect(() => {
        if (visibleLen >= SAMPLE.length) return
        const timer = window.setTimeout(() => {
            setVisibleLen((v) => Math.min(SAMPLE.length, v + CHUNK_MIN + Math.floor(Math.random() * (CHUNK_MAX - CHUNK_MIN + 1))))
        }, CHUNK_INTERVAL_MS + Math.floor(Math.random() * CHUNK_JITTER_MS))
        return () => window.clearTimeout(timer)
    }, [visibleLen])

    const restart = useCallback(() => setVisibleLen(0), [])

    const streaming = visibleLen < SAMPLE.length
    const raw = useMemo(() => SAMPLE.slice(0, visibleLen), [visibleLen])
    // Streamdown 面板同样吃抖动缓冲平滑后的流：它只对「新挂载的 span」做动画，
    // 突发直出时文本一坨一坨地跳（一顿一顿）；mobi 的 drip 匀速追赶揭示
    // 正是补这个的平滑层——平滑层保留、动画层换 Streamdown
    const sdDisplay = useStreamingContent(raw, streaming)
    const sdStreaming = sdDisplay.length < SAMPLE.length
    const display = sdDisplay

    return (
        <div className={`streamdown-spike${isDark ? ' dark' : ''}`} style={{ padding: 16 }}>
            <div className="sd-controls">
                <button type="button" onClick={restart}>{streaming ? '⟳ 重播' : '▶ 播放'}</button>
                <span style={{ opacity: 0.5 }}>{streaming || sdStreaming ? 'streaming…' : 'done'}</span>
            </div>
            <div className="sd-ab">
                <section className="sd-panel">
                    <h3>StreamdownView（正式新栈 + 排版映射）</h3>
                    <StreamdownView content={display} isAnimating={sdStreaming} mathEnabled />
                </section>
                <section className="sd-panel">
                    <h3>mobi 现行（XMarkdown + 逐字揭示）</h3>
                    <Markdown content={raw} streaming typing={streaming} />
                </section>
            </div>
        </div>
    )
}

export default StreamdownSpikePage
