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
    /** 图片 objectURL（null 时渲染空容器） */
    imgUrl: string | null
    /** 文件路径（img alt） */
    filePath: string
}

/**
 * 图片文件内容视图（纯展示）：
 * - objectURL 直显（objectURL 由外壳通过 blob.effect 算好传入）
 * - 后续 P3 SW 缓存（spec 2）在此组件内实现
 */
export default function ImageContentView({ imgUrl, filePath }: ImageContentViewProps) {
    return (
        <div style={{ textAlign: 'center', padding: 12, overflow: 'auto' }}>
            {imgUrl && <img src={imgUrl} alt={filePath} style={{ maxWidth: '100%' }} />}
        </div>
    )
}
