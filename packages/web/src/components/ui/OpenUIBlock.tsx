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
 * fenced ```openui 块渲染入口（mermaid 同构先例：markdown code 组件按 lang 分流）。
 * 实际渲染器在 ./openui/renderer 的懒加载 chunk 里（react-ui 组件库 + 样式体积大，
 * 首个 openui 块出现才加载）。本文件保持薄壳，进主 bundle 的只有 lazy/Suspense。
 */

import { lazy, Suspense } from 'react'

const LazyOpenUIRenderer = lazy(() => import('./openui/renderer'))

export interface OpenUIBlockProps {
    /** fence 内的 OpenUI Lang 源码 */
    code: string
    /** 所在消息是否仍在流式 */
    streaming: boolean
}

export function OpenUIBlock({ code, streaming }: OpenUIBlockProps) {
    return (
        <Suspense
            fallback={<div className="openui-block-loading" style={{ padding: 16, color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>渲染中…</div>}
        >
            <LazyOpenUIRenderer code={code} streaming={streaming} />
        </Suspense>
    )
}
