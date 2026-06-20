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

import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { Folder, Terminal, FileSearch } from 'lucide-react'
import styled from '@emotion/styled'

const Wrap = styled.div`
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
`

interface InspectorEmptyStateProps {
    /** 点「文件」 */
    onOpenFile: () => void
}

/**
 * 空态：垂直 + 水平居中的 3 个引导按钮。
 * 终端/审查 disabled（未支持）。仅「文件」可点。
 */
export function InspectorEmptyState({ onOpenFile }: InspectorEmptyStateProps) {
    const { t } = useTranslation()
    return (
        <Wrap>
            <Button size="large" icon={<Folder size={18} />} onClick={onOpenFile}>
                {t('session.inspector.openFile')}
            </Button>
            <Button size="large" icon={<Terminal size={18} />} disabled>
                {t('session.inspector.terminal')}
            </Button>
            <Button size="large" icon={<FileSearch size={18} />} disabled>
                {t('session.inspector.review')}
            </Button>
        </Wrap>
    )
}
