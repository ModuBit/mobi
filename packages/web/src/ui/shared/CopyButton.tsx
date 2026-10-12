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
 * 只做 i18n 文案适配与调用点收口；复制行为/动效由 registry 组件承担，
 * clipboard 降级见 copy-button/use-copy-feedback（copyTextToClipboard）。
 *
 * 不挂 Tooltip：按钮的可访问名（aria-label）与 aria-live 状态区已表达「是什么 / 结果如何」，
 * 气泡在此并无增量信息；且点击时文案从「复制」变「已复制」会让正开着的气泡改宽重排，
 * 与图标交叉淡出叠在一起就是肉眼可见的闪动。
 * 与移动端长按菜单共用的工具函数在 core/utils/clipboard。
 */

import { useTranslation } from 'react-i18next'
import { CopyButton as ArcCopyButton } from '@/ui/shadcn/copy-button/copy-button'

interface CopyButtonProps {
    text: string
    className?: string
}

export function CopyButton({ text, className }: CopyButtonProps) {
    const { t } = useTranslation()

    return (
        <ArcCopyButton
            value={text}
            label={t('chat.copy')}
            copiedLabel={t('chat.copied')}
            failedLabel={t('chat.copyFailed')}
            iconOnly
            variant="plain"
            className={className}
        />
    )
}
