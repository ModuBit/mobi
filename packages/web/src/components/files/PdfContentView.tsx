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

import { lazy, Suspense } from 'react'
import { Spin } from 'antd'

// react-pdf / pdfjs 体积较大且非首屏，用 React.lazy 动态 import 拆 chunk（mitigate pending #19）
const PdfContentViewImpl = lazy(() => import('./PdfContentViewImpl'))

interface PdfContentViewProps {
    /** 会话 ID（拼 read-file 端点 url，pdfjs 走 HTTP Range 按需加载） */
    sessionId: string
    /** 所属 tab id（读写 tab.viewState 记忆缩放+滚动） */
    tabId: string
    /** 文件路径（拼 url query param path） */
    filePath: string
}

/**
 * PDF 内容视图（懒加载壳）：
 * - 真正的 react-pdf 渲染逻辑在 PdfContentViewImpl，按需加载
 * - 加载期间展示 Spin 占位
 */
export default function PdfContentView(props: PdfContentViewProps) {
    return (
        <Suspense fallback={<div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>}>
            <PdfContentViewImpl {...props} />
        </Suspense>
    )
}
