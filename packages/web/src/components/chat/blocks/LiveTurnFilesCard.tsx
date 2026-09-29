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
 * 流式 turn 文件卡（审查 v3 票05）：turn 进行中的实时「已编辑文件」轻量列表。
 * 数据来自 projectLiveTurnFiles 的消息流投影（不可展开、无审核按钮）——权威
 * turn-diff 卡到达后本卡消失（buildBubbleItems 在 result 边界重置投影段）。
 * 行样式复用 TurnDiffCard 的 present 组件，视觉与终态卡连续。
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDiff } from 'lucide-react'
import { theme } from 'antd'
import { FilePathLabel, DiffStat } from '@/components/turnDiff/present'
import type { LiveTurnFile } from '../liveTurnFiles'

export const LiveTurnFilesCard = memo(function LiveTurnFilesCard({ files }: { files: LiveTurnFile[] }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()

    const additions = files.reduce((sum, f) => sum + f.additions, 0)
    const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

    return (
        <div
            data-testid="live-turn-files"
            className="turn-diff-fullwidth"
            style={{
                width: '100%',
                border: `1px dashed ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                background: token.colorBgContainer,
                padding: '10px 16px',
                margin: '4px 0',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                    aria-hidden
                    style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, flexShrink: 0,
                        borderRadius: token.borderRadiusLG, background: token.colorFillTertiary,
                    }}
                >
                    <FileDiff size={14} color={token.colorTextTertiary} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
                        {t('chat.turnDiff.liveFiles', { count: files.length })}
                    </div>
                    <DiffStat additions={additions} deletions={deletions} fontSize={token.fontSizeSM} />
                </div>
            </div>
            <div style={{ marginTop: 6, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 2 }}>
                {files.map((file) => (
                    <div
                        key={file.path}
                        data-testid="live-turn-file"
                        style={{ display: 'flex', alignItems: 'center', gap: token.marginSM, padding: '3px 0' }}
                    >
                        <FilePathLabel path={file.path} />
                        <DiffStat additions={file.additions} deletions={file.deletions} fontSize={token.fontSizeSM} />
                    </div>
                ))}
            </div>
        </div>
    )
})
