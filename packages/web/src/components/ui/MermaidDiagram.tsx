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

import { useEffect, useState } from 'react'

// mermaid 库懒加载（~1MB，首次遇 mermaid 图才加载），模块级单例
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null
function loadMermaid(): Promise<typeof import('mermaid')['default']> {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
            // 主题：default（深色 mermaid 对齐后续优化）
            mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
            return mermaid
        })
    }
    return mermaidPromise
}

interface Props {
    /** mermaid 源码 */
    code: string
}

/**
 * mermaid 图渲染（懒加载 + 缓存）。编辑器 NodeView 与只读预览共用，
 * 保证编辑态/只读态渲染一致。
 */
export function MermaidDiagram({ code }: Props) {
    const [svg, setSvg] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        // mermaid.render 需唯一 id（页面内多图不冲突）
        const id = 'mermaid-' + Math.random().toString(36).slice(2, 10)
        loadMermaid().then((mermaid) => {
            if (cancelled) return
            mermaid.render(id, code)
                .then(({ svg }) => { if (!cancelled) setSvg(svg) })
                .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
        }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
        return () => { cancelled = true }
    }, [code])

    if (error) {
        return <pre style={{ color: 'var(--ant-color-error, #ff4d4f)', margin: 0, fontSize: 12 }}>{error}</pre>
    }
    if (!svg) {
        return <div style={{ padding: 16, color: 'var(--ant-color-text-tertiary, gray)', fontSize: 12 }}>渲染中…</div>
    }
    return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
