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
 * 设置页调试区块（隐蔽，需连点创建页品牌 Logo ≥5 次解锁）
 *
 * 移动端没有原生 devtools console，调试能力统一收敛到此处：
 * - **诊断埋点开关**：切换 diag（渲染链路诊断埋点，见 core/lib/diag）
 * - **一键下载诊断数据**：导出 `window.__mobiDiag.dump()`（等价 dumpDiag()）为 JSON 文件，
 *   刷新/关页后现场不丢，问题复现后可回传数据排查
 *
 * 后续调试能力（vConsole 开关等）都追加到这里，作为移动端调试的统一入口。
 * 未解锁（!isDebugUnlocked()）时整个区块不渲染。
 */

import { useState } from 'react'
import { App, theme as antTheme } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { Bug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import { isDebugUnlocked } from '@/core/lib/debug'
import { isDiagEnabled, enableDiag, disableDiag, dumpDiag } from '@/core/lib/diag'
import { SettingGroupCard } from '@/features/settings/blocks/SettingGroupCard'
import { SettingRow } from '@/features/settings/blocks/SettingRow'
import { IconButton } from '@/ui/base/interactive/IconButton'

/** 区块说明行（组卡内首行灰字，与行式形态的 CardHint 同语言） */
const CardHint = styled.div<{ $token: { colorTextTertiary: string } }>`
    padding: 10px 16px 2px;
    font-size: 12px;
    line-height: 1.5;
    color: ${p => p.$token.colorTextTertiary};
`

/** 下载诊断数据为 JSON 文件（内容等价 window.__mobiDiag.dump()） */
function downloadDiagData(message: ReturnType<typeof App.useApp>['message'], t: (k: string) => string): void {
    try {
        const data = dumpDiag()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `mobi-diag-${Date.now()}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        message.success(t('debug.downloaded'))
    } catch {
        message.error(t('debug.downloadFailed'))
    }
}

export function DebugSection() {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const { message } = App.useApp()
    // diag 模块级 enabled 非响应式，本地镜像状态驱动 Switch 渲染
    const [diagOn, setDiagOn] = useState(isDiagEnabled())

    // 未解锁（默认）：整个区块不渲染
    if (!isDebugUnlocked()) return null

    const toggleDiag = () => {
        if (diagOn) {
            disableDiag()
            setDiagOn(false)
            message.success(t('debug.diagOff'))
        } else {
            // 手动开关 = 从空开始（禁用时 disableDiag 已清空内存与 LS 镜像，无可恢复的现场）。
            // 刷新/关页不丢由 initDiag 的持久化标记 + restoreFromLS 在页面加载时自动承担，
            // 不在此 restore：否则 disable 后残留的旧状态键会重建 seenToolIds/recordedCreatedIds，
            // 使同批历史消息重放时旧 toolUseId 被当作新「created」重复记录（diag 刷屏）。
            enableDiag({ restore: false })
            setDiagOn(true)
            message.success(t('debug.diagOn'))
        }
    }

    const handleDownload = () => {
        // 未开启时 dump 为空（enabled:false），提示后仍下载，便于查看数据格式
        if (!isDiagEnabled()) message.warning(t('debug.diagNotEnabled'))
        downloadDiagData(message, t)
    }

    return (
        <SettingGroupCard>
            <CardHint $token={token}>{t('debug.desc')}</CardHint>
            <SettingRow
                icon={Bug}
                label={t('debug.diagLabel')}
                variant="switch"
                checked={diagOn}
                onCheckedChange={toggleDiag}
            />
            <SettingRow
                label={t('debug.download')}
                variant="action"
                action={
                    <IconButton
                        icon={<DownloadOutlined />}
                        size={26}
                        aria-label={t('debug.download')}
                        onClick={handleDownload}
                    />
                }
            />
        </SettingGroupCard>
    )
}
