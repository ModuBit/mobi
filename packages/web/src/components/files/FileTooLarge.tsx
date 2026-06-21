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

import { Empty, Button } from 'antd'
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface FileTooLargeProps {
    sessionId: string
    filePath: string
    /** 不支持预览的原因文案 key（如 files.tooLarge / files.binaryDownload） */
    reason: string
}

/**
 * 文件过大 / 不支持预览：提示 + 下载按钮。
 * 下载指向 /read-file?download=1（P0 已支持 Content-Disposition，触发浏览器下载）。
 */
export default function FileTooLarge({ sessionId, filePath, reason }: FileTooLargeProps) {
    const { t } = useTranslation()
    const downloadUrl = `/api/sessions/${sessionId}/read-file?path=${encodeURIComponent(filePath)}&download=1`
    return (
        <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Empty description={reason} />
            <Button
                type="primary"
                icon={<Download size={14} />}
                href={downloadUrl}
                download
                style={{ marginTop: 12 }}
            >
                {t('files.download')}
            </Button>
        </div>
    )
}
