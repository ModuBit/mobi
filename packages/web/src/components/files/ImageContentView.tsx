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

interface ImageContentViewProps {
    /** 会话 id（拼 read-file 端点 src） */
    sessionId: string
    /** 文件路径（img alt + src query） */
    filePath: string
}

/**
 * 图片文件内容视图（纯展示）：
 * - src 直连 read-file 端点（cookie 改造后 httpOnly mobi_token 自动带 → 认证通过）
 * - 浏览器原生 HTTP 缓存（端点 ETag + Cache-Control 协商 304）
 */
export default function ImageContentView({ sessionId, filePath }: ImageContentViewProps) {
    const src = `/api/sessions/${sessionId}/read-file?path=${encodeURIComponent(filePath)}`
    return (
        <div style={{ textAlign: 'center', padding: 12, overflow: 'auto' }}>
            <img src={src} alt={filePath} style={{ maxWidth: '100%' }} />
        </div>
    )
}
