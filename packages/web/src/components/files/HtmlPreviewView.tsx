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

import { Empty } from 'antd'
import { useTranslation } from 'react-i18next'
import TextContentView from './TextContentView'
import { SandboxHtmlFrame } from './SandboxHtmlFrame'

interface Props {
    sessionId: string
    filePath: string
    /** 'render'=预览(iframe), 'source'=源码(TextContentView) */
    view: 'render' | 'source'
    text: string
    wrap: boolean
}

export default function HtmlPreviewView({ sessionId, filePath, view, text, wrap }: Props) {
    const { t } = useTranslation()
    if (view === 'source') {
        return <TextContentView text={text} filePath={filePath} highlight wrap={wrap} />
    }
    // 空文件路径才降级提示；越界判定已下沉 hub（isWithinDir）
    if (!filePath) {
        return <Empty description={t('files.previewUnavailable')} style={{ marginTop: 40 }} />
    }
    // 预览态 = SandboxHtmlFrame 的 inspector chrome（铺满容器）；iframe 机制在 frame 单源
    return (
        <div className="html-preview-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SandboxHtmlFrame
                sessionId={sessionId}
                path={filePath}
                title="html-preview"
                style={{ flex: 1, border: 'none', minHeight: 0 }}
            />
        </div>
    )
}
