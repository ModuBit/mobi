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

import { useCallback, useState } from 'react'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/ui/IconButton'

interface CopyButtonProps {
    text: string
    size?: number
    className?: string
}

/**
 * 写剪贴板（navigator.clipboard 失败时降级 execCommand——非安全上下文/旧内核）。
 * CopyButton 与移动端消息长按操作菜单共用。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        return ok
    }
}

export function CopyButton({ text, size = 20, className }: CopyButtonProps) {
    const [copied, setCopied] = useState(false)
    const { t } = useTranslation()

    const handleCopy = useCallback(async () => {
        await copyTextToClipboard(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [text])

    return (
        <IconButton
            className={className}
            icon={copied ? <CheckOutlined style={{ fontSize: size * 0.7 }} /> : <CopyOutlined style={{ fontSize: size * 0.7 }} />}
            size={size}
            tooltip={copied ? t('chat.copied') : t('chat.copy')}
            tooltipPlacement="top"
            onClick={handleCopy}
        />
    )
}
