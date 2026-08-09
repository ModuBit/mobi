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
import { ensureRendered, readMermaid } from '@/components/files/mermaidRender'

interface Props {
    /** mermaid 源码 */
    code: string
}

/**
 * mermaid 图渲染（React 组件，只读预览用）。与编辑器 decoration 共享 mermaidRender
 * 的 svg 缓存，同一份 code 不重复跑 dagre。
 *
 * 渲染成单个 `<img src="svg data URL">`（详见 mermaidRender）。
 */
export function MermaidDiagram({ code }: Props) {
    // ensureRendered 异步完成后 bump tick 重渲染（读缓存已是 ready）
    const [, setTick] = useState(0)
    useEffect(() => {
        let cancelled = false
        if (readMermaid(code).status === 'loading') {
            void ensureRendered(code).then(() => { if (!cancelled) setTick((t) => t + 1) })
        }
        return () => { cancelled = true }
    }, [code])

    const r = readMermaid(code)
    if (r.status === 'error') {
        return <pre style={{ color: 'var(--ant-color-error, #ff4d4f)', margin: 0, fontSize: 12 }}>{r.error}</pre>
    }
    if (r.status === 'loading') {
        return <div style={{ padding: 16, color: 'var(--ant-color-text-tertiary, gray)', fontSize: 12 }}>渲染中…</div>
    }
    // alt 留空：图本身是内容，但其文本表达即源码，编辑器里可切源码查看；此处作装饰图
    return <img className="mermaid-diagram" src={r.dataUrl} alt="" draggable={false} style={{ maxWidth: '100%' }} />
}
