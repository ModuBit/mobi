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
 * 消息流复制按钮适配壳（uiarc copy-button 的 iconOnly 形态，shadcn 底座首个迁移组件）：
 * 集成 antd Tooltip（hover 文案随复制状态翻转）与 i18n；复制行为/动效由 arc 组件承担，
 * clipboard 降级见 arc/lib/use-copy-feedback（copyTextToClipboard）。
 * 与移动端长按菜单共用的工具函数在 core/utils/clipboard。
 */

import { useRef, useState } from 'react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { CopyButton as ArcCopyButton } from '@/components/arc/copy-button/copy-button'

interface CopyButtonProps {
    text: string
    className?: string
}

export function CopyButton({ text, className }: CopyButtonProps) {
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)
    // 复位定时器随组件卸载清理（tooltip 文案回「复制」）
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    return (
        <Tooltip title={copied ? t('chat.copied') : t('chat.copy')}>
            <ArcCopyButton
                value={text}
                label={t('chat.copy')}
                copiedLabel={t('chat.copied')}
                failedLabel={t('chat.copyFailed')}
                iconOnly
                variant="plain"
                className={className}
                onCopied={() => {
                    if (resetTimer.current) clearTimeout(resetTimer.current)
                    setCopied(true)
                    resetTimer.current = setTimeout(() => setCopied(false), 2000)
                }}
            />
        </Tooltip>
    )
}
